const express = require("express");
const multer = require("multer")
const {createClient} = require("@supabase/supabase-js")
const jwt = require("jsonwebtoken");
const { getInvoice, startInvoiceOCR } = require('../services/invoiceOcrEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

const upload = multer({ storage: multer.memoryStorage()});
const router = express.Router();

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
    const { invoice, processing } = await startInvoiceOCR(file);
    res.json({status: "extracting", id: invoice.id})
    await processing;
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
    .select(`*,
      suppliers(name)`)
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
    const invoice = await getInvoice(invoiceId);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    return res.json({ invoice });
  } catch (err) {
    console.error('Invoice detail error:', err);
    return res.status(500).json({ error: 'Unable to load invoice details' });
  }
});

module.exports = router
