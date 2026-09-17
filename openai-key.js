function normalizeOpenAiApiKey(value){
  let key=String(value||"").trim();
  const stripWrappingQuotes=input=>{
    const first=input[0];
    const last=input[input.length-1];
    return input.length>=2&&((first==='"'&&last==='"')||(first==="'"&&last==="'")||(first==='`'&&last==='`'))
      ? input.slice(1,-1).trim()
      : input;
  };
  key=stripWrappingQuotes(key);
  key=key.replace(/^OPENAI_API_KEY\s*=\s*/i,"").trim();
  key=stripWrappingQuotes(key);

  // OpenAI API keys contain no whitespace. This also removes line breaks and
  // invisible characters that can be introduced when copying on a phone.
  return key.replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g,"");
}

function openAiApiKeyStatus(value){
  const raw=String(value||"");
  const key=normalizeOpenAiApiKey(raw);
  const configured=key.startsWith("sk-")&&key.length>20&&!key.includes("your_openai_key_here");
  return {
    key,
    configured,
    configuration_error:configured?null:(raw.trim()?"invalid_format":"missing")
  };
}

module.exports={normalizeOpenAiApiKey,openAiApiKeyStatus};
