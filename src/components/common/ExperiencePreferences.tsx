"use client";
import {useEffect} from "react";
export const MOTION_KEY="together_reduce_motion_v1";
export function ExperiencePreferences(){useEffect(()=>{try{document.documentElement.dataset.reduceMotion=localStorage.getItem(MOTION_KEY)==="1"?"true":"false";}catch{}},[]);return null;}
