export type LinePayload = { to:string; messages:[{type:"image";originalContentUrl:string;previewImageUrl:string}|{type:"text";text:string}] };

function secure(value:string) {
  const url=new URL(value);
  if(url.protocol!=="https:" || url.username || url.password)throw new Error("OUTBOUND_HTTPS_REQUIRED");
  return url.toString();
}
export function imageLinePayload(recipient:string,original:string,preview:string):LinePayload {
  if(!recipient.trim())throw new Error("OUTBOUND_RECIPIENT_INVALID");
  return {to:recipient,messages:[{type:"image",originalContentUrl:secure(original),previewImageUrl:secure(preview)}]};
}
export function pdfLinePayload(recipient:string,url:string):LinePayload {
  if(!recipient.trim())throw new Error("OUTBOUND_RECIPIENT_INVALID");
  return {to:recipient,messages:[{type:"text",text:`PDF: ${secure(url)}`}]};
}
export function classifyLinePush(status:number,acceptedRequestId:boolean):"accepted"|"failed"|"unknown" {
  if((status>=200 && status<300) || (status===409 && acceptedRequestId))return "accepted";
  if(status===429 || status>=500 || status<400)return "unknown";
  return "failed";
}
