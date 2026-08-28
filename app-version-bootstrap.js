"use strict";

const express=require("express");

const CURRENT_VERSION="8.2.8";
const CURRENT_RELEASE_DATE="2026-08-22";
const CURRENT_APK_URL="https://23s.tv/IPTV/worldtv8.2.8-20260822.apk";

function currentAppInfo(req,res){
  res.setHeader("Cache-Control","no-store");
  res.json({
    name:"World TV",
    version:CURRENT_VERSION,
    releaseDate:CURRENT_RELEASE_DATE,
    size:"~30MB",
    description:"Watch live TV, movies, series and sports from around the world",
    features:[
      "4,000+ live TV channels",
      "Movies and series catalog",
      "Live football scores",
      "Multiple quality options",
      "Android TV, Google TV, Android phone and tablet compatible",
      "Free 3-day trial"
    ],
    downloadUrl:"/api/app/download",
    trialInfo:"Get 3 days free trial. No credit card required."
  });
}

function currentAppDownload(req,res){
  res.setHeader("Cache-Control","no-store");
  res.redirect(302,CURRENT_APK_URL);
}

const originalGet=express.application.get;
express.application.get=function worldTvCurrentAppGet(route,...handlers){
  if(route==="/api/app/info"){
    return originalGet.call(this,route,currentAppInfo);
  }
  if(route==="/api/app/download"){
    return originalGet.call(this,route,currentAppDownload);
  }
  return originalGet.call(this,route,...handlers);
};

console.log(`WORLD TV app API standardized on v${CURRENT_VERSION}`);
