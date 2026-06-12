import express from "express";
import multer from "multer";
import * as mindee from "mindee";
import {createClient} from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const upload = multer({ storage: multer.memoryStorage()});
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
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
      // uploading raw file to supabase first 
      const fileName = `invoices/${Date.now()}_${file.originalname}`;
      const {data: storageData, error:storageError} = await supabase.storage
          .from('invoices')
          .upload(fileName, file.buffer, {contentType: file.mimetype});
      if (storageError) throw storageError
      const { data: { publicUrl } } = supabase.storage
          .from('invoices')
          .getPublicUrl(fileName);
      // !ADD MINDEE CODE HERE 
      const inputSource = mindeeClient.docFromBuffer(file.buffer, file.originalname)
      const apiResponse = await mindeeClient.enqueueAndParse(
        Mindee.product.InvoiceV4,
        inputSource
      );
      const doc = apiResponse.document.inference.prediction
      const invoiceData = {
        file_url: publicUrl,
        vendor_name: doc.supplierName?.value || null,
        invoice_number: doc.invoiceNumber?.value || null,
        invoice_date: doc.date?.value || null,
        due_date: doc.dueDate?.value || null,
        total_amount: doc.totalAmount?.value || null,
        tax_amount: doc.totalTax?.value || null,
        currency: doc.locale?.currency || 'INR',
        line_items: doc.lineItems?.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total: item.totalAmount,
        })) || [],
        raw_ocr_response: apiResponse.document,
      };

      const {data: invoice, error:dbError} = await supabase
      .from('invoice')
      .upsert(invoiceData)
      .select()
      .single()

      if (dbError) throw dbError

      res.json({success: true, invoice})

    }
    catch(err){
        console.error("Invoice processing error ",err)
        res.status(500).json({error: err.message})
    }
})

router.get('/', verifyEmployeeAuth, async (req,res)=>{
    const{data, error }= supabase
    .from('invoices')
    .select("*")
    .order("created_at", {ascending: false})

    if (error) return res.status(500).json({erorr : error.message})
    
    res.json(data)
})

export default router;