const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function createSupplierFromInvoice(dataBody){
    console.dir(dataBody, {depth: null})
    try{    
        const {
            name, 
            contact_number,
            GSTIN,
            state,
            IFSC,
            account_number,
            email,
            billing_address
        } = dataBody
        // if( GSTIN !== null && name!== null){
        //     return {message: 'GSTIN and name required'}
        // }

        // const {data: existing, error: existingError} = await supabase
        // .from('suppliers')
        // .select('id')
        // .eq('GSTIN', GSTIN)
        // .maybeSingle()

        // if(existingError) throw existingError

        // if(existing){
        //     return res.status(204).json({
        //         message: "Supplier already exists"
        //     })
        // }

        const insertPayload= {
            name: name,
            contact_number: contact_number,
            GSTIN: GSTIN,
            state: state,
            ifsc: IFSC,
            account_number: account_number,
            email: email,
            billing_address: billing_address
        }

        const {data: newSupplier, error:dbError} = await supabase
        .from('suppliers')
        .upsert(insertPayload)
        .select()

        if (dbError) throw dbError

        return newSupplier

    }
    catch (err){
        throw err
    }
}

module.exports = {createSupplierFromInvoice}
