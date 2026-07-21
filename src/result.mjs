// @ts-check
/** @param {any} value @returns {{ok:true,value:any}} */
export const ok = (value) => ({ ok: true, value });
/** @param {string} error @returns {{ok:false,error:string}} */
export const err = (error) => ({ ok: false, error });
