const express = require('express')
const jwt = require('jsonwebtoken')
const multer = require('multer')
const {createClient} = require('@supabase/supabase-js');
const path = require('path');

const router = express.Router();
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
)

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-inv"
const upload = multer({storage: multer.memoryStorage(), limits:{fileSize : 5 * 1024 * 1024}})
const STORAGE_BUCKET = 'photos'

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

async function uploadCertificatePhoto(supplierId, file) {
  if (!file) {
    return null;
  }

  const extension = path.extname(file.originalname).toLowerCase() || '.jpg';
  const filePath = `${supplierId}${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }
  const { data: publicUrlData, error: publicUrlError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);

  if (publicUrlError) {
    throw publicUrlError;
  }

  return publicUrlData?.publicUrl || null;
}

router.get('/',verifyEmployeeAuth, async(req,res)=>{
    try{
        const {data, error} = await supabase
        .from('suppliers')
        .select('*')
        .order('name', {ascending: true})
        
        if(error){
            throw error;
        }

        const suppliers = (data || []).map((s)=>({
            id: s.id,
            name: s.name,
            official_address: s.official_address,
            billing_address: s.billing_address,
            GSTIN: s.GSTIN,
            PAN_no: s.pan_no,
            contact_person: s.contact_person,
            contact_number: s.contact_number,
            email: s.email,
            customer_recommended: s.customer_recommended,
            bank_name: s.bank_name,
            account_number : s.account_number,
            account_type: s.account_type,
            IFSC: s.ifsc,
            payment_details: s.payment_details,
            iso_certificate_url: s.iso_certificate_url,
        }))

        return res.json({ suppliers })
    }
    catch(err){
        console.error('Supplier list error ', err)
        return res.status(500).json({error: "Unable to load suppliers"})
    }
})

router.post('/', verifyEmployeeAuth, upload.single('photo'), async(req, res)=>{
    try {
        const {
            name,
            official_address,
            billing_address,
            GSTIN,
            PAN_no,
            contact_person,
            contact_number,
            email,
            customer_recommended,
            bank_name,
            account_number,
            account_type,
            IFSC,
            payment_details
        } = req.body

        if (!name || !GSTIN || !account_number ){
            return res.status(400).json({
                error: 'name, GSTIN, account number are required'
            })
        }

        const {data: existing, error:checkError} = await supabase
        .from('suppliers')
        .select('id')
        .eq('GSTIN', GSTIN)
        .maybeSingle();;

        if(checkError && checkError.code !== 'PGRST116'){
            throw checkError
        }

        if(existing){
            return res.status(409).json({
                error: 'Supplier already exists'
            })
        }

        const insertPayload = {
            name: name,
            official_address: official_address,
            billing_address: billing_address || null,
            GSTIN: GSTIN,
            pan_no: PAN_no || null,
            contact_person: contact_person || null,
            contact_number: contact_number || null,
            email: email || null,
            customer_recommended: customer_recommended === 'true' || customer_recommended === true,
            bank_name: bank_name,
            account_number: account_number,
            account_type: account_type || null,
            ifsc: IFSC,
            payment_details: payment_details || null
        }

        const  {data: newSupplier, error:insertError} = await supabase
        .from('suppliers')
        .insert(insertPayload)
        .select();

        if(insertError) throw insertError

        const createdSupplier = newSupplier[0]

        if(req.file){
            const certUrl = await uploadCertificatePhoto(createdSupplier.id, req.file)
            if (certUrl){
                const {error: certificateError} = await supabase
                .from('suppliers')
                .update({iso_certificate_url: certUrl})
                .eq('id', createdSupplier.id)

                if (certificateError) throw certificateError
            }

            createdSupplier.iso_certificate_url = certUrl
        }

        return res.status(201).json({
            message: 'Supplier Created Successfully',
            supplier: createdSupplier,
        })
    }
    catch(err){
        console.error("Supplier Creation error", err)
        return res.status(500).json({error: "Unable to create Supplier"})
    }
})

router.put('/:id', verifyEmployeeAuth, upload.single('photo'), async(req, res)=>{
    try {
        const supplierId = req.params.id
        const {
            name,
            official_address,
            billing_address,
            GSTIN,
            PAN_no,
            contact_person,
            contact_number,
            email,
            customer_recommended,
            bank_name,
            account_number,
            account_type,
            IFSC,
            payment_details
        } = req.body

        if (!name || !GSTIN || !account_number ){
            return res.status(400).json({
                error: 'name, GSTIN, account number are required'
            })
        }

        const updatePayload = {
            name: name,
            official_address: official_address || null,
            billing_address: billing_address || null,
            GSTIN: GSTIN,
            pan_no: PAN_no || null,
            contact_person: contact_person || null,
            contact_phone: contact_number || null,
            email: email || null,
            customer_recommended: customer_recommended === 'true' || customer_recommended === true,
            bank_name: bank_name || null,
            account_number: account_number,
            account_type: account_type || null,
            ifsc: IFSC || null,
            payment_details: payment_details || null
        }

        if(req.file){
            updatePayload.iso_certificate_url = await uploadCertificatePhoto(supplierId, req.file)
        }

        const {data: updatedSupplier, error:updateError} = await supabase
        .from('suppliers')
        .update(updatePayload)
        .eq('id', supplierId)
        .select()
        .single()

        if(updateError) throw updateError

        return res.json({
            message: 'Supplier Updated Successfully',
            supplier: updatedSupplier,
        })
    }
    catch(err){
        console.error("Supplier update error", err)
        return res.status(500).json({error: "Unable to update Supplier"})
    }
})



module.exports = router
