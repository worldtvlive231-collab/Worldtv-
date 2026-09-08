"use strict";

const express=require("express");

const CURRENT_VERSION="8.2.8";
const CURRENT_RELEASE_DATE="2026-08-22";

function currentAppInfo(req,res){
  res.setHeader("Cache-Control","no-store");
  res.json({
    name:"World TV",
    version:CURRENT_VERSION,
    releaseDate:CURRENT_RELEASE_DATE,
    size:"~30MB",
    description:"WORLD TV Android application",
    downloadUrl:"/api/app/download",
    trialInfo:"Get 3 days free trial. No credit card required."
  });
}

const originalGet=express.application.get;
express.application.get=function worldTvCurrentAppGet(route,...handlers){
  if(route==="/api/app/info"){
    return originalGet.call(this,route,currentAppInfo);
  }
  return originalGet.call(this,route,...handlers);
};

console.log(`WORLD TV app info standardized on v${CURRENT_VERSION}; download route uses server analytics`);
