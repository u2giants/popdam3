// Current-state ColdLion master projections. API keys are retained exactly for
// shape validation; database columns follow the already-applied landing schema.

const f = (api, column, type = "text") => ({ api, column, type });
const common = [f("createdTime", "created_time", "ts"), f("modTime", "mod_time", "ts")];

export const MASTER_SPECS = Object.freeze({
  customer: {
    endpoint: "/customers", key: ["company_code", "customer_code"], paged: true, active: true,
    fields: [f("companyCode","company_code"),f("customerCode","customer_code"),...common,f("active","active"),f("customerDesc","customer_desc"),f("vendorNumber","vendor_number"),f("address1","address1"),f("address2","address2"),f("address3","address3"),f("aRCustomerCode","ar_customer_code"),f("city","city"),f("commissionPerc1","commission_perc1","num"),f("commissionPerc2","commission_perc2","num"),f("countryCode","country_code"),f("createdUser","created_user"),f("currencyCode","currency_code"),f("customerDBA","customer_dba"),f("customerTypeCode","customer_type_code"),f("dsCat","ds_cat"),f("factorCode","factor_code"),f("faxNo","fax_no"),f("glCode","gl_code"),f("modUser","mod_user"),f("oldCustomerCode","old_customer_code"),f("parentCustomerCode","parent_customer_code"),f("phoneNo","phone_no"),f("regionCode","region_code"),f("salesPersonCode1","sales_person_code1"),f("salesPersonCode2","sales_person_code2"),f("state","state"),f("udf01","udf01"),f("udf02","udf02"),f("udf03","udf03"),f("udf04","udf04"),f("udfDate01","udf_date01","date"),f("udfDate02","udf_date02","date"),f("useConsolidatedInvoice","use_consolidated_invoice"),f("zipCode","zip_code")],
  },
  vendor: {
    endpoint: "/vendors", key: ["company_code", "vendor_code"], paged: true, active: true,
    fields: [f("companyCode","company_code"),f("vendorCode","vendor_code"),...common,f("vendorDesc","vendor_desc"),f("city","city"),f("countryCode","country_code"),f("active","active"),f("femaExpDate","fema_exp_date","date"),f("nbcExpDate","nbc_exp_date","date")],
    ignored: ["createdUser","modUser","address1","address2","address3","state","zipCode","phoneNo","faxNo","email","udf01","udf02","udf03","udf04","udfDate01","udfDate02","payTermCode","glCode","separateCheck"],
  },
  division: {
    endpoint: "/divisions", key: ["company_code", "division_code"], paged: true, active: true,
    fields: [f("companyCode","company_code"),f("divisionCode","division_code"),f("divisionDesc","division_desc"),f("accDivCode","acc_div_code"),f("ediDivisionCode","edi_division_code"),f("generalLedgerCode","general_ledger_code"),f("itemNoCode","item_no_code"),f("manuFacturerCode","manu_facturer_code"),f("dunsNo","duns_no"),f("currencyCode","currency_code"),f("countryCode","country_code"),f("address1","address1"),f("address2","address2"),f("city","city"),f("state","state"),f("zipCode","zip_code"),f("phoneNo","phone_no"),f("faxNo","fax_no"),f("upcCurrent","upc_current"),f("upcStart","upc_start"),f("upcEnd","upc_end"),f("active","active"),...common],
    ignored: ["createdUser","modUser"],
  },
  salesperson: {
    endpoint: "/salespersons", key: ["company_code", "salesperson_code"], paged: true, active: true,
    fields: [f("companyCode","company_code"),f("salesPersonCode","salesperson_code"),f("lastName","last_name"),f("active","active"),...common],
    ignored: ["address1","address2","city","commissionPerc","country","createdUser","email","faxNo","firstName","generalLedgerCode","modUser","phoneNo","quota","salesPersonType","state","territoryCode","uDF01","uDF02","userId","zipCode"],
  },
  season: {
    endpoint: "/seasons", key: ["company_code", "division_code", "season_code"], paged: true, active: true, perDivision: true,
    fields: [f("companyCode","company_code"),f("divisionCode","division_code"),f("seasonCode","season_code"),...common],
    ignored: ["seasonDesc","startDate","endDate","shipStartDate","shipEndDate","active","createdUser","modUser"],
  },
  merch_group_header: {
    endpoint: "/merchGroupHeaders", key: ["company_code","division_code","mg_type_code"], paged: true,
    fields: [f("companyCode","company_code"),f("divisionCode","division_code"),f("mgTypeCode","mg_type_code"),...common,f("mgTypeDesc","mg_type_desc")],
    ignored: ["createdUser","modUser"],
  },
  merch_group_detail: {
    endpoint: "/merchGroupDetails", key: ["company_code","division_code","mg_type_code","mg_category","mg_code"], paged: false, active: true,
    fields: [f("companyCode","company_code"),f("divisionCode","division_code"),f("mgTypeCode","mg_type_code"),f("mgCode","mg_code"),...common,f("mgDesc","mg_desc"),f("itemNoCode","item_no_code"),f("mgCategory","mg_category","keytext"),f("mgCode2","mg_code2"),f("active","active")],
    ignored: ["createdUser","modUser"],
  },
});

const itemFields = [
  f("companyCode","company_code"),f("divisionCode","division_code"),f("itemNo","item_no"),...common,
  f("itemDesc","item_desc"),f("itemStatus","item_status"),f("seasonCode","season_code"),f("udf01","udf01"),f("udf02","udf02"),f("udf03","udf03"),f("udf04","udf04"),f("udfDate01","udf_date01","date"),f("udfDate02","udf_date02","date"),f("retailPrice","retail_price","num"),f("itemLength","item_length","num"),f("itemWidth","item_width","num"),f("itemHeight","item_height","num"),f("itemWeight","item_weight","num"),f("innerPackQty","inner_pack_qty","num"),f("originCountry","origin_country"),f("itemCost","item_cost","num"),f("htsNumber","hts_number"),f("royaltyCode","royalty_code"),f("cartonQty","carton_qty","num"),f("itemPriceA","item_price_a","num"),f("itemPriceB","item_price_b","num"),f("itemPriceC","item_price_c","num"),f("itemPriceD","item_price_d","num"),f("itemNote","item_note"),f("designNo","design_no"),f("poLeadTime","po_lead_time","num"),f("mfgLeadTime","mfg_lead_time","num"),f("sellingPrice","selling_price","num"),f("royaltyCode2","royalty_code2"),f("cartonLength","carton_length","num"),f("cartonWidth","carton_width","num"),f("cartonHeight","carton_height","num"),f("comparePrice","compare_price","num"),f("itemDisplayDesc","item_display_desc"),f("nonInventoryItem","non_inventory_item"),f("itemVolume","item_volume","num"),f("active","active"),f("itemAvailable","item_available"),f("itemDiscontinued","item_discontinued"),f("cartonWeight","carton_weight","num"),f("salesPersonCode1","sales_person_code1"),f("salesPersonCode2","sales_person_code2"),f("productManager","product_manager"),f("htsNumber2","hts_number2"),f("brandAssuranceNo","brand_assurance_no"),f("movieArt","movie_art"),f("characterLikeness","character_likeness"),f("contractSampleSentDate","contract_sample_sent_date","date"),f("contractSampleDate","contract_sample_date","date"),f("annualSampleSentDate","annual_sample_sent_date","date"),f("annualSampleDate","annual_sample_date","date"),f("contractSampleQty","contract_sample_qty","num"),f("annualSampleQty","annual_sample_qty","num"),f("preproApproved","prepro_approved"),f("preproApprovedDate","prepro_approved_date","date"),f("characterList","character_list"),f("mGCategory","mg_category"),f("hasImage","has_image")
];
const itemIgnored = ["createdUser","modUser","uomCode","sizeRangeCode","itemContent","measurementUOM","weightUOM","itemPriceE","itemPriceF","itemPriceG","baseQty","itemPriceH","allowedSizes","replenishSource","replenishPolicy","reOrderQty","reOrderPoint","onHandMin","onHandMax","vendorCode","packType","oldItemNo","udfInt01","udfNum01","taxCatCode","taxExempt","cartonPackType","cartonCode","dutiable","chargeFreight","commodityCode","sizeExplosionCode","dSCat","catalog01","catalog02","catalog03","catalog04","catalog05","catalog06","catalog07","catalog08","catalog09","catalog10","catalog11","catalog12","catalog13","catalog14","excludeShippingAdvice","costComponent1","costComponent2","costComponent3","costComponent4","costComponent5","giftWrap"];

const detailFields = [
  f("companyCode","company_code"),f("divisionCode","division_code"),f("itemNo","item_no"),f("itemPkey","item_pkey"),...common,f("labelCode","label_code"),f("labelDesc","label_desc"),f("prePackCode","pre_pack_code"),f("upc","upc"),f("itemStatus","item_status"),f("retailPrice","retail_price","num"),f("itemCost","item_cost","num"),f("udf01","udf01"),f("udf02","udf02"),f("udf03","udf03"),f("udf04","udf04"),f("udfDate01","udf_date01","date"),f("udfDate02","udf_date02","date"),f("htsNumber","hts_number"),f("itemLength","item_length","num"),f("itemWidth","item_width","num"),f("itemHeight","item_height","num"),f("itemWeight","item_weight","num"),f("innerPackQty","inner_pack_qty","num"),f("royaltyCode","royalty_code"),f("itemPriceA","item_price_a","num"),f("itemPriceB","item_price_b","num"),f("itemPriceC","item_price_c","num"),f("itemPriceD","item_price_d","num"),f("cartonQty","carton_qty","num"),f("sellingPrice","selling_price","num"),f("royaltyCode2","royalty_code2"),f("nMFCCode","nmfc_code"),f("cartonLength","carton_length","num"),f("cartonWidth","carton_width","num"),f("cartonHeight","carton_height","num"),f("itemVolume","item_volume","num"),f("seasonCode","season_code"),f("active","active"),f("itemAvailable","item_available"),f("itemDiscontinued","item_discontinued"),f("cartonWeight","carton_weight","num"),f("salesPersonCode1","sales_person_code1"),f("salesPersonCode2","sales_person_code2"),f("actualDims","actual_dims")
];
const detailIgnored = ["createdUser","modUser","colorCode","dimCode","sizeCode","ean","gtin","uomCode","measurementUOM","itemWeightUom","htsNumber2","itemPriceE","itemPriceF","itemPriceG","itemPriceH","baseQty","sizeSeq","generateUPC","sizeAllowed","shareUPC","vendorCode","itemContent","reservedQty","packType","udfInt01","udfNum01","itemPriceE","itemPriceF","itemPriceG","itemPriceH","dSCat","dutiable","catalog01","catalog02","catalog03","catalog04","catalog05","catalog06","catalog07","catalog08","catalog09","catalog10","catalog11","catalog12","catalog13","catalog14","costComponent1","costComponent2","costComponent3","costComponent4","costComponent5","cartonCode","cartonPackType","cartonPallets","comparePrice","edi832Proc","edi832ProcDate","glSku","isbn","itemPriceE","itemPriceF","itemPriceG","itemPriceH","measurementUOM","sizeExplosionCode","upcGeneratedTime","variantSKU","warehouseSKU"];

export const ITEM_SPECS = Object.freeze({
  item_header: { endpoint: "/items", key: ["company_code","division_code","item_no"], paged: true, fields: itemFields, ignored: itemIgnored, slots: true },
  item_detail: { endpoint: "/itemDetails", key: ["company_code","division_code","item_no","item_pkey"], paged: false, fields: detailFields, ignored: detailIgnored, slots: true },
});

export function knownApiFields(spec) {
  const fields = new Set([...spec.fields.map((x) => x.api), ...(spec.ignored ?? [])]);
  if (spec.slots) for (let n = 1; n <= 14; n += 1) {
    const nn = String(n).padStart(2, "0"); fields.add(`merchGroup${nn}`); fields.add(`merchGroup${nn}Desc`);
  }
  return fields;
}
