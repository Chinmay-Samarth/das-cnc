const express = require("express");
const multer = require("multer")
const Mindee = require("mindee")
const {createClient} = require("@supabase/supabase-js")
const jwt = require("jsonwebtoken");
const { invoice } = require("mindee/src/v1/product");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

const upload = multer({ storage: multer.memoryStorage()});
const router = express.Router();
const mindeeClient = new Mindee.Client({ apiKey: process.env.MINDEE_API_KEY });

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

router.post("/upload", verifyEmployeeAuth, upload.single('invoice'), async (req,res)=>{
    try {
      const file = req.file

      if(!file){
        return res.status(400).json({
          error: "No file Uploaded"
        })
      }

      // uploading raw file to supabase first 
      const fileName = `invoices/${Date.now()}_${file.originalname}`;

      const {data: storageData, error:storageError} = await supabase.storage
          .from('invoices')
          .upload(fileName, file.buffer, {contentType: file.mimetype});

      if (storageError) throw storageError
      const { data: { publicUrl } } = await supabase.storage
          .from('invoices')
          .getPublicUrl(fileName);

      // !ADD MINDEE CODE HERE 

      const buffer = file.buffer
      const inputSource = new Mindee.BufferInput({buffer, filename : fileName})

      const modelParams = {
        modelId: "2a4ccdd5-e3e3-4801-bba2-6bbca01bae4f",
        // Options: set to `true` or `false` to override defaults
        // Enhance extraction accuracy with Retrieval-Augmented Generation.
        rag: true,
        // Extract the full text content from the document as strings.
        rawText: false,
        // Calculate bounding box polygons for all fields.
        polygon: false,
        // Boost the precision and accuracy of all extractions.
        // Calculate confidence scores for all fields.
        confidence: false,
      };

      const apiResponse = await mindeeClient.enqueueAndGetResult(
        Mindee.product.Extraction,
        inputSource,
        modelParams
      );

      console.dir(apiResponse.rawHttp.inference, {depth: null})

      // const doc = apiResponse.document.inference.prediction
      const doc = apiResponse.rawHttp.inference.result.fields

      let supplier_GSTIN

      doc.supplier_company_registration.items.forEach((item) => {  
        if(item.fields.type.value === "GSTIN"){
          supplier_GSTIN = item.fields.number.value
        }
      });

      console.log(supplier_GSTIN)

      let irn

      doc.reference_numbers.items.forEach((item)=>{
        if (item.value.length === 64){
          irn = item.value
        }
      })
      // 
      const invoiceData = {
        file_url: publicUrl,
        supplier_name: doc.supplier_name?.value || null,
        invoice_number: doc.invoice_number?.value || null,
        invoice_date: doc.date?.value || null,
        due_date: doc.due_date?.value || null,
        base_amount: doc.total_net?.value || null,
        total_amount: doc.total_amount?.value || null,
        tax_amount: doc.total_tax?.value || null,
        line_items: doc.line_items.items?.map(item => ({
          description: item.fields.description.value,
          quantity: item.fields.quantity.value,
          unit_price: item.fields.unit_price.value,
          total: item.fields.total_price.value,
        })) || [],
        tax_items: doc.taxes.items?.map(item =>({
          rate: item.fields.rate.value,
          base: item.fields.base.value,
          amount: item.fields.base.value
        })),
        raw_ocr_response: doc,
        customer_GSTIN: doc.customer_company_registration.items[0].fields.number.value,
        supplier_GSTIN : supplier_GSTIN,
        supplier_address: doc.supplier_address.fields.address.value,
        IRN: irn,
      };

      const {data: invoice, error:dbError} = await supabase
      .from('invoices')
      .upsert(invoiceData)
      .select()
      .single()

      if (dbError) throw dbError

      console.dir(apiResponse, {depth:null, colors:true})

      res.json({success: true, invoice })

    }
    catch(err){
        console.error("Invoice processing error ",err)
        res.status(500).json({error: err.message})
    }
})

router.get('/list', verifyEmployeeAuth, async (req,res)=>{
  try{

    const{data:invoices, error }= await supabase
    .from('invoices')
    .select("*")
    .order("created_at", {ascending: false})
    
    if (error) return res.status(500).json({erorr : error.message})
      
    res.json(invoices)
  }
  catch(err){
    return res.status(500).json({error: err})
  }
})

router.get('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { data, error } = await supabase
      .from('invoices')
      .select(`*`)
      .eq('id', invoiceId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = data

    return res.json({ invoice });
  } catch (err) {
    console.error('Invoice detail error:', err);
    return res.status(500).json({ error: 'Unable to load invoice details' });
  }
});

module.exports = router