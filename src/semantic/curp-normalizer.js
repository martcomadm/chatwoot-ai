const CURP_RE=/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;
export function normalizeCurp(text){
  const compact=String(text??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const candidates=compact.match(/[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d/g)||[];
  const value=candidates.find(v=>CURP_RE.test(v))||null;
  return value?{value,valid:true,rule:'curp_compact_normalization'}:{value:null,valid:false,rule:null};
}
export function containsNormalizedCurp(text){return Boolean(normalizeCurp(text).value);}
