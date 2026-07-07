import React, { useState, useEffect, useRef } from "react";
import {
  currentAuth,
  logout as dbLogout,
  loginAdmin,
  loginShow,
  listEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent as deleteEvent_api,
  setPassword as dbSetPassword,
  listTemplates,
  createTemplate,
  deleteTemplate,
  getCosting,
  saveCosting,
  importQuote,
  listInventory,
  saveInventoryCase,
  deleteInventoryCase,
  listRoster,
  saveRosterMember,
  deleteRosterMember,
  getPositions,
  savePositions,
  generateOnboardLink,
  previewInventoryImport,
  confirmInventoryImport,
} from "./db.js";

/* ============================================================
   CALLBOARD — a production hub for live-event crews.
   Share the brief with your crew + track hours, per event.
   Data lives in Airtable via a Vercel serverless proxy; access is per-show.
   ============================================================ */

const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) =>
  typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o));

/* Data layer lives in ./db.js (talks to the Vercel API). Diagrams are link-only in the
   cloud build, so there is no local image store here. */

/* ---------- structure helpers ---------- */
const ioRow = (num, name = "", patch = "", signal = "", notes = "") => ({
  id: uid(), num: String(num), name, patch, signal, notes,
});
const ioBlock = (name, ins = [], outs = []) => ({ id: uid(), name, ins, outs });

/* ---------- pull list: categories + seed gear ---------- */
const PULL_CATS = {
  Audio:    { color: "#2563EB", soft: "#EFF4FF", ring: "#BFD3FF" },
  Video:    { color: "#7C3AED", soft: "#F5F0FF", ring: "#D9C7FF" },
  Lighting: { color: "#D97706", soft: "#FFF6EA", ring: "#F3D8A8" },
  Power:    { color: "#DC2626", soft: "#FEF1F1", ring: "#F4BFBF" },
  Scenic:   { color: "#059669", soft: "#ECFAF4", ring: "#B7E7D4" },
  Misc:     { color: "#475569", soft: "#F1F4F8", ring: "#CBD5E1" },
};
const PULL_CAT_ORDER = ["Audio", "Video", "Lighting", "Power", "Scenic", "Misc"];
const pullItem = () => ({ id: uid(), drawer: null, item: "", qty: "", source: "", rentedFrom: "", notes: "", out: false, in: false });
const PULL_SEED = [
  { id: "pc1", caseNo: 1, "case": "AUDIO / SPEAKERS", category: "Audio", items: [
    { id: "pi1", drawer: null, item: "Syva High", qty: 2, source: "Sub Rental", rentedFrom: "R&R", notes: "", out: false, in: false },
    { id: "pi2", drawer: null, item: "Syva Low", qty: 2, source: "Sub Rental", rentedFrom: "R&R", notes: "", out: false, in: false },
    { id: "pi3", drawer: null, item: "L'Acoustics Amps", qty: 2, source: "Sub Rental", rentedFrom: "R&R", notes: "", out: false, in: false },
    { id: "pi4", drawer: null, item: "L'Acoustics 5XT", qty: 4, source: "Sub Rental", rentedFrom: "KAT", notes: "", out: false, in: false },
    { id: "pi5", drawer: null, item: "L'Acoustics Amp", qty: 1, source: "Sub Rental", rentedFrom: "KAT", notes: "", out: false, in: false },
  ] },
  { id: "pc2", caseNo: 2, "case": "Audio Console", category: "Audio", items: [
    { id: "pi6", drawer: null, item: "DM7 Compact", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc3", caseNo: 3, "case": "DM 3 RACK", category: "Audio", items: [
    { id: "pi7", drawer: null, item: "Yamaha DM3-D", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi8", drawer: null, item: "Netgear Switches", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi9", drawer: null, item: "Quad ULX-D", qty: 3, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc4", caseNo: 4, "case": "CLEAR-COM RACK", category: "Audio", items: [
    { id: "pi10", drawer: null, item: "Arcadia", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi11", drawer: null, item: "4-Channel Helixnet Beltpacks", qty: 8, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi12", drawer: null, item: "2-Channel Helixnet Beltpacks", qty: 4, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi13", drawer: null, item: "Freespeak Beltpacks", qty: 12, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi14", drawer: null, item: "IP Transceivers", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi15", drawer: null, item: "Ubiquiti POE Switch", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi16", drawer: null, item: "Ethernet Cable", qty: "", source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc5", caseNo: 5, "case": "E2 RACK", category: "Video", items: [
    { id: "pi17", drawer: null, item: "E2", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi18", drawer: null, item: "12x12 SDI Router", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi19", drawer: null, item: "Mini PC", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi20", drawer: null, item: "Touchscreen Monitor", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi21", drawer: null, item: "Laptop", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi22", drawer: null, item: "Ubiquiti Router", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi23", drawer: null, item: "Ubiquiti Switch", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi24", drawer: null, item: "USB-C to DisplayPort Cables", qty: 10, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi25", drawer: null, item: "Yamaha Tio", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc6", caseNo: 6, "case": "RECORD RACK", category: "Video", items: [
    { id: "pi26", drawer: null, item: "Hyperdeck Studio HD Plus", qty: 5, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi27", drawer: null, item: "CloudStore", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi28", drawer: null, item: "10G Switch", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi29", drawer: null, item: "Ubiquiti Switch", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi30", drawer: null, item: "17\" Monitor", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi31", drawer: null, item: "Mac Mini", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi32", drawer: null, item: "2 M/E Constellation", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc7", caseNo: 7, "case": "MONITOR CASE", category: "Video", items: [
    { id: "pi33", drawer: null, item: "43\" TV", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi34", drawer: null, item: "27\" Monitor", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi35", drawer: null, item: "22\" Monitor", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc8", caseNo: 8, "case": "BIGGER MONITOR CASE", category: "Video", items: [
    { id: "pi36", drawer: null, item: "55\" Monitor", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi37", drawer: null, item: "32\" Monitor", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi38", drawer: null, item: "27\" Touchscreen", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi39", drawer: null, item: "Graphics Laptops", qty: 6, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi40", drawer: null, item: "MacBooks", qty: 4, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc9", caseNo: 9, "case": "FIBER", category: "Video", items: [
    { id: "pi41", drawer: null, item: "Fiber Reel 250ft", qty: "", source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi42", drawer: null, item: "12G Fiber Box", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi43", drawer: null, item: "3G Fiber Box", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc10", caseNo: 10, "case": "SPEAKER TIMER", category: "Misc", items: [
    { id: "pi44", drawer: null, item: "Speaker Timer Unit", qty: "", source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc11", caseNo: 11, "case": "VIDEO CABLE WORKBOX", category: "Video", items: [
    { id: "pi45", drawer: "Audio DI (A)", item: "Peavey USB-P", qty: 6, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi46", drawer: "Audio DI (A)", item: "ART USB DI Digital to Analog Converter", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi47", drawer: "Audio DI (B)", item: "LyxPro 4Ch Audio/DMX Extender", qty: 10, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi48", drawer: "Audio DI (B)", item: "ART DualZDirect Dual Channel Passive Direct Box", qty: 3, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi49", drawer: "Audio DI (B)", item: "Blackdog Studio USB-DI", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi50", drawer: "SDI/HDMI 10-25ft", item: "10ft HDMI Cable", qty: 14, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi51", drawer: "SDI/HDMI 10-25ft", item: "25ft HDMI Cable", qty: 10, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi52", drawer: "SDI/HDMI 50ft", item: "50ft HDMI Cable", qty: 14, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi53", drawer: "SDI/HDMI 50ft", item: "50ft SDI Cable", qty: 6, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi54", drawer: "SDI/HDMI 100ft", item: "100ft HDMI Cable", qty: 10, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi55", drawer: "SDI/HDMI 100ft", item: "100ft SDI Cable", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc12", caseNo: 12, "case": "VIDEO WORKBOX", category: "Video", items: [
    { id: "pi56", drawer: "MD-LX / HDMI Split", item: "MD-LX", qty: 20, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi57", drawer: "MD-LX / HDMI Split", item: "REI 1x4 HDMI Splitter", qty: 5, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi58", drawer: "Dongles / Fiber Con", item: "HDI-SDI Fiber Optic Converter", qty: 25, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi59", drawer: "Dongles / Fiber Con", item: "BlackMagicDesign Mini Converter Fiber Optic", qty: 8, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi60", drawer: "MD-HX & 12G Cross", item: "Decimator 12G-Cross", qty: 4, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi61", drawer: "MD-HX & 12G Cross", item: "Decimator MD-HX", qty: 7, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi62", drawer: "MD-HX & 12G Cross", item: "Decimator DMON-QUAD", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi63", drawer: "MD-HX & 12G Cross", item: "Thunderbolt 3 Mini Dock W/ Dual 4K HDMI", qty: 3, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi64", drawer: "MD-HX & 12G Cross", item: "DJI SDR Transmission", qty: 4, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi65", drawer: "PerfectCues/USB/Stackers", item: "PerfectCue Extender", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi66", drawer: "PerfectCues/USB/Stackers", item: "PerfectCue", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi67", drawer: "PerfectCues/USB/Stackers", item: "PerfectCue Two Button Transmitter", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi68", drawer: "PerfectCues/USB/Stackers", item: "USB C-HDMI Bag", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi69", drawer: "PerfectCues/USB/Stackers", item: "USB C-C Bag", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi70", drawer: "PerfectCues/USB/Stackers", item: "USB C-B Bag", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi71", drawer: "PerfectCues/USB/Stackers", item: "USB A-C Bag", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi72", drawer: "PerfectCues/USB/Stackers", item: "USB A-Micro Bag", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi73", drawer: "PerfectCues/USB/Stackers", item: "USB A-Lightning Bag", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi74", drawer: "PerfectCues/USB/Stackers", item: "USB Power Bricks Bag", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi75", drawer: "Network", item: "AX1800 Wireless Router", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi76", drawer: "Network", item: "Dual-Band WiFi 7 Travel Router", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi77", drawer: "Network", item: "AC1200 Wireless Travel Router + Pwr Supply", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi78", drawer: "Network", item: "1ft CAT Cable Bag", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi79", drawer: "Network", item: "Ethernet Patch Cable Bag", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi80", drawer: "Network", item: "10ft Ethernet Cable", qty: 9, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi81", drawer: "Network", item: "15ft Ethernet Cable", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi82", drawer: "Network", item: "TP-Link 16-Port Switch + Pwr Supply", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi83", drawer: "Network", item: "TP-Link 8-Port Switch + Pwr Supply", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi84", drawer: "Network", item: "REI 1x4 HDMI Splitter + Pwr Supply", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi85", drawer: "Fiber/Screen/SDI Monitor", item: "Fostex 6301B Personal Monitor", qty: 4, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi86", drawer: "Fiber/Screen/SDI Monitor", item: "Fiber Fault Tester / Fiber Optic Cleaner", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi87", drawer: "Fiber/Screen/SDI Monitor", item: "4K On-Camera Monitor 7\"", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi88", drawer: "Fiber/Screen/SDI Monitor", item: "Fiber Optic Cable", qty: 5, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc13", caseNo: 13, "case": "AUDIO WORKBOX", category: "Audio", items: [
    { id: "pi89", drawer: "XLR", item: "10ft XLR Cable", qty: 20, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi90", drawer: "XLR", item: "25ft XLR Cable", qty: 10, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi91", drawer: "XLR", item: "50ft XLR Cable", qty: 10, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi92", drawer: "XLR", item: "100ft XLR Cable", qty: 10, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc14", caseNo: 14, "case": "PRODUCER WORKBOX", category: "Misc", items: [
    { id: "pi93", drawer: null, item: "Printer", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi94", drawer: null, item: "Office Supplies", qty: "", source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi95", drawer: null, item: "Misc Audio", qty: "", source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi96", drawer: null, item: "First Aid Kit", qty: "", source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc15", caseNo: 15, "case": "BIG POWER TRUNK", category: "Power", items: [
    { id: "pi97", drawer: null, item: "200A Distro", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi98", drawer: null, item: "Doghouses", qty: 5, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi99", drawer: null, item: "L21-30 Flat - 25ft", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi100", drawer: null, item: "L21-30 Flat - 50ft", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi101", drawer: null, item: "L21-30 10ft", qty: 3, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi102", drawer: null, item: "L21-30 25ft", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi103", drawer: null, item: "L21-30 50ft", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi104", drawer: null, item: "L21-30 100ft", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi105", drawer: null, item: "Feeder 10ft", qty: 5, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc16", caseNo: 16, "case": "EDISON CABLE TRUNK", category: "Power", items: [
    { id: "pi106", drawer: null, item: "Power Strips", qty: 20, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi107", drawer: null, item: "10ft Edison", qty: 20, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi108", drawer: null, item: "25ft Edison", qty: 10, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi109", drawer: null, item: "50ft Edison", qty: 5, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi110", drawer: null, item: "100ft Edison", qty: 5, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi111", drawer: null, item: "Stringers", qty: 5, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc17", caseNo: 17, "case": "TRUSS / STAGING", category: "Lighting", items: [
    { id: "pi112", drawer: null, item: "80ft Gray Drape", qty: "", source: "Venue", rentedFrom: "Encore", notes: "", out: false, in: false },
    { id: "pi113", drawer: null, item: "Uplights", qty: "", source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi114", drawer: null, item: "DSM Stands", qty: 2, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc18", caseNo: 18, "case": "Scenic", category: "Scenic", items: [
    { id: "pi115", drawer: null, item: "10' X 20' Backdrop Frames", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi116", drawer: null, item: "10' X 20' Skin/Returns", qty: 1, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
    { id: "pi117", drawer: null, item: "Sandbags", qty: 10, source: "TCG", rentedFrom: "", notes: "", out: false, in: false },
  ] },
  { id: "pc19", caseNo: 19, "case": "LED", category: "Video", items: [
    { id: "pi118", drawer: null, item: "Ground Support Package", qty: "", source: "Sub Rental", rentedFrom: "Matrix", notes: "", out: false, in: false },
    { id: "pi119", drawer: null, item: "Processor Package", qty: "", source: "Sub Rental", rentedFrom: "Matrix", notes: "", out: false, in: false },
    { id: "pi120", drawer: null, item: "Distro Package", qty: "", source: "Sub Rental", rentedFrom: "Matrix", notes: "", out: false, in: false },
    { id: "pi121", drawer: null, item: "10' x 40' LED Wall", qty: "", source: "Sub Rental", rentedFrom: "Matrix", notes: "", out: false, in: false },
    { id: "pi122", drawer: null, item: "Sandbags", qty: "", source: "Sub Rental", rentedFrom: "Matrix", notes: "", out: false, in: false },
  ] },
];

/* ---------- pull list: templates (applied into a show; ids regenerated) ---------- */
function pullFreshCases(cases) {
  return clone(cases).map((c, ci) => ({
    ...c,
    id: uid(),
    caseNo: ci + 1,
    items: c.items.map((it) => ({ ...it, id: uid(), out: false, in: false })),
  }));
}
function pullFreshItems(items) {
  return clone(items || []).map((it) => ({ ...it, id: uid(), out: false, in: false }));
}
// normalize a template payload to { cases, loose } (older templates were a bare cases array)
function pullTplData(x) {
  if (Array.isArray(x)) return { cases: x, loose: [] };
  return { cases: Array.isArray(x?.cases) ? x.cases : [], loose: Array.isArray(x?.loose) ? x.loose : [] };
}
const PULL_SMALL_CASES = ["Audio Console", "AUDIO / SPEAKERS", "CLEAR-COM RACK", "MONITOR CASE", "AUDIO WORKBOX", "EDISON CABLE TRUNK"];
const PULL_TEMPLATES = [
  {
    key: "full",
    name: "Full Corporate Rig",
    desc: "Complete kit — audio, video, LED, power, scenic",
    count: () => PULL_SEED.reduce((n, c) => n + c.items.length, 0),
    build: () => ({ cases: pullFreshCases(PULL_SEED), loose: [] }),
  },
  {
    key: "small",
    name: "Small Show",
    desc: "Single-room kit — console, speakers, comms, monitors, cable & power",
    count: () => PULL_SEED.filter((c) => PULL_SMALL_CASES.includes(c.case)).reduce((n, c) => n + c.items.length, 0),
    build: () => ({ cases: pullFreshCases(PULL_SEED.filter((c) => PULL_SMALL_CASES.includes(c.case))), loose: [] }),
  },
  {
    key: "blank",
    name: "Empty (categories only)",
    desc: "Six empty cases, one per category — build from scratch",
    count: () => 0,
    build: () => ({ cases: PULL_CAT_ORDER.map((cat, i) => ({ id: uid(), caseNo: i + 1, case: cat + " Case", category: cat, drawers: [], items: [] })), loose: [] }),
  },
];

/* backfill any fields a stored event predates, so old data never crashes */
function normalize(e) {
  if (!e) return e;
  e.venue = e.venue || { name: "", address: "", mapLink: "" };
  e.contacts = e.contacts || [];
  e.crew = e.crew || [];
  e.schedule = e.schedule || [];
  e.itinerary = e.itinerary || { hotelName: "", hotelAddress: "", stays: [], flights: [] };
  e.meals = e.meals || [];
  e.notes = e.notes || [];
  e.links = e.links || [];
  e.time = e.time || { days: [], entries: {} };
  // upgrade an AdventHealth seed saved before these tabs existed
  if (e.id === "seed-adventhealth") {
    const s = seedEvent();
    if (!e.audio) e.audio = s.audio;
    if (!e.video) e.video = s.video;
    if (!e.records) e.records = s.records;
    if (!e.diagrams) e.diagrams = s.diagrams;
  }
  e.audio = e.audio || { blocks: [ioBlock("Main")] };
  e.video = e.video || { blocks: [ioBlock("Main")] };
  e.crew = e.crew.map((c) => ({
    rosterId: null, rateType: "day", rate: "", ...c,
  }));
  e.records = e.records || [];
  e.diagrams = e.diagrams || [];
  e.documents = e.documents || [];
  e.pull = e.pull || { cases: [] };
  if (!Array.isArray(e.pull.cases)) e.pull.cases = [];
  if (!Array.isArray(e.pull.loose)) e.pull.loose = [];
  e.pull.cases.forEach((cs) => {
    if (!Array.isArray(cs.drawers)) {
      const names = [];
      (cs.items || []).forEach((it) => {
        const d = (it.drawer || "").trim();
        if (d && !names.includes(d)) names.push(d);
      });
      cs.drawers = names;
    }
  });
  if (typeof e.gearEditUnlocked !== "boolean") e.gearEditUnlocked = false;
  if (typeof e.scheduleUnlocked !== "boolean") e.scheduleUnlocked = false;
  return e;
}

/* ---------- time math ---------- */
function hoursBetween(inStr, outStr) {
  const a = schedMinutes(inStr);
  const b = schedMinutes(outStr);
  if (a == null || b == null) return 0;
  let mins = b - a;
  if (mins < 0) mins += 24 * 60; // overnight
  return Math.round((mins / 60) * 100) / 100;
}
const fmtHrs = (h) => (h === 0 ? "–" : String(+h.toFixed(2)));
/* split a day's hours into pay tiers: reg ≤10, OT (×1.5) 10–12, DT (×2) 12+ */
function otBreakdown(h) {
  const reg = Math.min(h, 10);
  const ot = Math.max(0, Math.min(h, 12) - 10);
  const dt = Math.max(0, h - 12);
  return { reg, ot, dt };
}

/* ---------- blank + seed data ---------- */
function blankEvent() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: uid(),
    name: "New Event",
    client: "",
    startDate: today,
    endDate: today,
    venue: { name: "", address: "", mapLink: "" },
    contacts: [
      { id: uid(), role: "Production Manager", name: "", phone: "", email: "" },
      { id: uid(), role: "Venue CSM", name: "", phone: "", email: "" },
      { id: uid(), role: "Client", name: "", phone: "", email: "" },
    ],
    crew: [],
    schedule: [],
    itinerary: { hotelName: "", hotelAddress: "", stays: [], flights: [] },
    meals: [],
    wardrobe: "",
    notes: [],
    links: [],
    time: { days: [], entries: {} },
    audio: { blocks: [ioBlock("Main")] },
    video: { blocks: [ioBlock("Main")] },
    records: [],
    diagrams: [],
    documents: [],
    pull: { cases: [], loose: [] },
    gearEditUnlocked: false,
    scheduleUnlocked: false,
  };
}

// (cloud build: diagrams are link-only, no seeded image)

function seedEvent() {
  const crew = [
    { id: "c1", name: "Tyler Groom", position: "PM", phone: "559-280-5274", email: "tyler.groom@gmail.com" },
    { id: "c2", name: "Jose Jimenez", position: "V1/E2", phone: "209.670.9358", email: "joe1245@sbcglobal.net" },
    { id: "c3", name: "Sean Reek", position: "LED Lead w/ PTZ Setup", phone: "209.747.2705", email: "seanreek@gmail.com" },
    { id: "c4", name: "Damian Dan", position: "LED Lead", phone: "707.980.8258", email: "brendanvb@gmail.com" },
    { id: "c5", name: "Jeff Bell", position: "L1", phone: "804-314-8014", email: "jeffbelldesigns@gmail.com" },
    { id: "c6", name: "Dan Parseghian", position: "A1", phone: "201-913-7644", email: "dparse2@gmail.com" },
    { id: "c7", name: "Chris Thomas", position: "Equipment Manager", phone: "408.679.5963", email: "chris@landonaudio.com" },
  ];

  const days = [
    { id: "d1", label: "Fri 6/19" },
    { id: "d2", label: "Sat 6/20" },
    { id: "d3", label: "Sun 6/21" },
    { id: "d4", label: "Mon 6/22" },
    { id: "d5", label: "Tue 6/23" },
    { id: "d6", label: "Wed 6/24" },
    { id: "d7", label: "Thu 6/25" },
    { id: "d8", label: "Fri 6/26" },
    { id: "d9", label: "Sat 6/27" },
    { id: "d10", label: "Sun 6/28" },
  ];

  const io = (i, o) => ({ in: i, out: o });
  const entries = {
    c1: { d1: io("06:00", "18:00"), d2: io("08:00", "18:00"), d3: io("07:00", "00:30"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c7: { d1: io("06:00", "18:00"), d2: io("08:00", "18:00"), d3: io("07:00", "00:30"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c2: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c3: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c4: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c5: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
    c6: { d2: io("08:00", "18:00"), d3: io("10:00", "21:00"), d4: io("06:00", "19:00"), d5: io("06:00", "16:00") },
  };

  const sched = (label, date, items) => ({
    id: uid(),
    date,
    label,
    items: items.map(([time, activity]) => ({ id: uid(), time, activity })),
  });

  return {
    id: "seed-adventhealth",
    name: "AdventHealth — Utah",
    client: "AdventHealth",
    startDate: "2026-06-19",
    endDate: "2026-06-28",
    venue: {
      name: "Stein Eriksen Lodge",
      address: "7700 Stein Way, Park City, UT 84060",
      mapLink: "",
    },
    contacts: [
      { id: uid(), role: "Production Manager", name: "Tyler Groom", phone: "559-280-5274", email: "tyler.groom@gmail.com" },
      { id: uid(), role: "Metro Coordinator", name: "William Redenbaugh", phone: "530-304-2816", email: "will.r@metroaudiovisual.com" },
      { id: uid(), role: "Venue CSM", name: "", phone: "", email: "" },
      { id: uid(), role: "Client", name: "", phone: "", email: "" },
      { id: uid(), role: "Trucking", name: "Mitchel", phone: "", email: "" },
      { id: uid(), role: "Labor Contact", name: "", phone: "", email: "" },
    ],
    crew,
    schedule: [
      sched("Saturday — Load prep", "2026-06-20", [
        ["1:00 PM", "Unload 1–2 box trucks, push cases to 1st-floor Silver Room (prioritize LED walls, flown PA, flown lights)"],
        ["All day", "Travel day for AH and Metro AV"],
      ]),
      sched("Sunday — Stein Ballroom", "2026-06-21", [
        ["7:00 AM", "Move cases Silver → Stein Ballroom · breakfast starts"],
        ["8:00 AM", "Rigging call (Wasatch AV): build truss, float motors, drop 3-phase power"],
        ["10:00 AM", "Load-in call time — all Metro + AH AV"],
        ["12:00 PM", "Lunch (stagger departments)"],
        ["1:00 PM", "Drop round stage"],
        ["6:00 PM", "Dinner · audio tunes PA (quiet time)"],
        ["8:00 PM", "End of day"],
      ]),
      sched("Monday — Stein Ballroom", "2026-06-22", [
        ["7:00 AM", "Crew breakfast"],
        ["8:30 AM", "Show crew call (Metro AV, Jamin, Andy)"],
        ["11:30 AM", "Show ready"],
        ["12:00 PM", "Crew lunch"],
        ["1:00 PM", "Executive rehearsals start"],
        ["6:30 PM", "End of day"],
      ]),
    ],
    itinerary: {
      hotelName: "Chateaux at Deer Valley",
      hotelAddress: "7700 Stein Way, Park City, UT 84060",
      stays: [
        { id: uid(), crewName: "Tyler Groom", checkIn: "2026-06-19", checkOut: "2026-06-28", confirmation: "873833", notes: "Crossload 6/19 w/ Chris T." },
        { id: uid(), crewName: "Jose Jimenez", checkIn: "2026-06-20", checkOut: "2026-06-28", confirmation: "873838", notes: "" },
        { id: uid(), crewName: "Sean Reek", checkIn: "2026-06-20", checkOut: "2026-06-28", confirmation: "873837", notes: "" },
        { id: uid(), crewName: "Damian Dan", checkIn: "2026-06-20", checkOut: "2026-06-27", confirmation: "874906", notes: "" },
        { id: uid(), crewName: "Jeff Bell", checkIn: "2026-06-20", checkOut: "2026-06-23", confirmation: "873834", notes: "" },
        { id: uid(), crewName: "Dan Parseghian", checkIn: "2026-06-20", checkOut: "2026-06-23", confirmation: "873839", notes: "" },
        { id: uid(), crewName: "Chris Thomas", checkIn: "2026-06-19", checkOut: "2026-06-28", confirmation: "873836", notes: "Crossload 6/19 w/ Tyler Groom" },
      ],
      flights: [
        { id: uid(), crewName: "Dan Parseghian", date: "2026-06-20", airport: "AUS → SLC", flightNo: "DL2618", depart: "08:15", arrive: "10:13", confirmation: "H68UQX", notes: "Non-stop" },
        { id: uid(), crewName: "Dan Parseghian", date: "2026-06-23", airport: "SLC → AUS", flightNo: "DL2728", depart: "17:45", arrive: "21:32", confirmation: "", notes: "Non-stop" },
        { id: uid(), crewName: "Chris Thomas", date: "2026-06-19", airport: "SMC → SLC", flightNo: "DL1367", depart: "09:45", arrive: "12:26", confirmation: "H7H98X", notes: "Non-stop" },
        { id: uid(), crewName: "Chris Thomas", date: "2026-06-28", airport: "SLC → SMC", flightNo: "DL1582", depart: "21:30", arrive: "22:16", confirmation: "", notes: "Updated" },
        { id: uid(), crewName: "Tyler Groom", date: "2026-06-19", airport: "FAT → SLC", flightNo: "DL3786", depart: "09:48", arrive: "12:18", confirmation: "", notes: "" },
        { id: uid(), crewName: "Tyler Groom", date: "2026-06-28", airport: "SLC → FAT", flightNo: "DL3774", depart: "20:30", arrive: "21:22", confirmation: "", notes: "" },
        { id: uid(), crewName: "Sean Reek", date: "2026-06-20", airport: "SMC → SLC", flightNo: "DL1423", depart: "13:30", arrive: "16:12", confirmation: "H8CS7H", notes: "Non-stop" },
        { id: uid(), crewName: "Jose Jimenez", date: "2026-06-20", airport: "SMC → SLC", flightNo: "DL1342", depart: "17:00", arrive: "19:43", confirmation: "GOJ7XU", notes: "Non-stop" },
        { id: uid(), crewName: "Jeff Bell", date: "2026-06-20", airport: "CLT → SLC", flightNo: "DL2070", depart: "17:25", arrive: "19:47", confirmation: "HPVGTJ", notes: "Non-stop" },
        { id: uid(), crewName: "Damian Dan", date: "2026-06-27", airport: "SLC → SFO", flightNo: "DL1091", depart: "21:40", arrive: "22:49", confirmation: "GF4CNY", notes: "Non-stop" },
      ],
    },
    meals: [
      { id: uid(), date: "2026-06-21", time: "6:00 PM", type: "Crew dinner", link: "" },
      { id: uid(), date: "2026-06-22", time: "12:00 PM", type: "Crew lunch", link: "" },
    ],
    wardrobe:
      "No holes in pants/shirts. No band, brand, team, or business logos other than Metro AV. Wear the Metro AV polo or t-shirt if you have one. Need one? Email April Potter at april@metroaudiovisual.com.",
    notes: [
      { id: uid(), date: "2026-06-18", text: "(4) 5xT speakers as front fills." },
      { id: uid(), date: "2026-06-18", text: "Send monitor stands for 5XTs — 3 feet high." },
      { id: uid(), date: "2026-06-18", text: "Upgrade to Galaxy for audio." },
    ],
    links: [
      { id: uid(), label: "Production Schedule", url: "" },
      { id: uid(), label: "Load Schedule", url: "" },
      { id: uid(), label: "Equipment List", url: "" },
      { id: uid(), label: "Rigging Diagrams", url: "" },
    ],
    time: { days, entries },
    audio: {
      blocks: [
        ioBlock(
          "FOH Console",
          [ioRow(1, "Wireless HH 1", "1", "Analog"), ioRow(2, "Lectern Mic", "3", "Analog"), ioRow(3, "Playback L/R", "9-10", "Analog", "From video")],
          [ioRow(1, "Mains L", "1", "Analog"), ioRow(2, "Mains R", "2", "Analog"), ioRow(3, "Front Fills", "3", "Analog", "(4) 5XT")]
        ),
      ],
    },
    video: {
      blocks: [
        ioBlock(
          "E2",
          [ioRow(1, "PGM from ATEM", "", "3G SDI"), ioRow(2, "Resolume", "Decklink", "12G SDI", "Cross Stage")],
          [
            ioRow(1, "LED WALL 1", "", "HDMI", "1536 × 1536"),
            ioRow(2, "LED WALL 2", "", "HDMI", "1537 × 1536"),
            ioRow(3, "LED WALL 3", "", "HDMI", "1538 × 1536"),
            ioRow(4, "LED WALL 4", "", "HDMI", "1539 × 1536"),
          ]
        ),
        ioBlock(
          "ATEM Constellation 4 M/E",
          [
            ioRow(1, "GFX 1", "", "SDI", "Cross Stage"),
            ioRow(2, "Notes 1", "", "SDI", "Cross Stage"),
            ioRow(3, "GFX 2", "", "SDI", "Cross Stage"),
            ioRow(4, "Notes 2", "", "SDI", "Cross Stage"),
            ioRow(5, "ProPresenter", "", "SDI", "Cross Stage"),
          ],
          [ioRow(1, "DSM 1", "", "SDI"), ioRow(2, "DSM 2", "", "SDI"), ioRow(3, "DSM 3", "", "SDI"), ioRow(4, "DSM 4", "", "SDI"), ioRow(5, "E2", "", "SDI")]
        ),
      ],
    },
    records: [
      { id: uid(), date: "2026-06-28", crew: "Chris Thomas", type: "Post-show note", text: "2× SDI cables flagged for repair — tagged in road case 4." },
      { id: uid(), date: "2026-06-28", crew: "Tyler Groom", type: "Post-show note", text: "Forklift returned to Sunbelt; confirmation emailed." },
    ],
    diagrams: [
      { id: uid(), name: "Stein Ballroom — Stage Plot", caption: "Host on Drive/Dropbox and paste the link", kind: "link", url: "" },
      { id: uid(), name: "Rigging Plot (Vectorworks)", caption: "Full rig — hosted PDF", kind: "link", url: "" },
    ],
    documents: [],
    pull: { cases: clone(PULL_SEED), loose: [] },
    gearEditUnlocked: false,
    scheduleUnlocked: false,
  };
}

/* ============================================================
   UI primitives
   ============================================================ */
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Panel({ title, sub, action, children }) {
  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <h2 className="panel-title">{title}</h2>
          {sub && <p className="panel-sub">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function AddBtn({ onClick, children }) {
  return (
    <button className="add" onClick={onClick} type="button">
      + {children}
    </button>
  );
}
function RemoveBtn({ onClick, title = "Remove" }) {
  return (
    <button className="remove" onClick={onClick} title={title} type="button" aria-label={title}>
      ×
    </button>
  );
}

/* ============================================================
   App
   ============================================================ */
function Callboard({ auth, onLogout }) {
  const isAdmin = auth.scope === "admin";
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState([]); // summaries
  const [currentId, setCurrentId] = useState(null);
  const [event, setEvent] = useState(null);
  const [tab, setTab] = useState("home");
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [toast, setToast] = useState("");
  const [loadError, setLoadError] = useState("");
  const loadingRef = useRef(false);
  const saveTimer = useRef(null);
  const statusTimer = useRef(null);

  /* initial load — admin lists every show; crew get only their unlocked show */
  useEffect(() => {
    (async () => {
      try {
        if (isAdmin) {
          let list = await listEvents();
          if (!list.length) {
            const seed = seedEvent();
            const created = await createEvent({
              name: seed.name, client: seed.client, startDate: seed.startDate, endDate: seed.endDate, data: seed,
            });
            list = [created];
          }
          const firstId = list[0].id;
          const first = normalize(await getEvent(firstId));
          loadingRef.current = true;
          setEvents(list);
          setCurrentId(firstId);
          setEvent(first);
        } else {
          const id = auth.showId;
          const ev = normalize(await getEvent(id));
          loadingRef.current = true;
          setEvents([{ id, name: ev.name, client: ev.client, startDate: ev.startDate, endDate: ev.endDate }]);
          setCurrentId(id);
          setEvent(ev);
        }
        setReady(true);
      } catch (e) {
        setLoadError(e.message || "Could not load. Try signing in again.");
        setReady(true);
      }
    })();
  }, []);

  /* autosave current event (debounced) → PATCH the Airtable record via our API */
  useEffect(() => {
    if (!event) return;
    if (loadingRef.current) {
      loadingRef.current = false;
      return;
    }
    setStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await updateEvent(event.id, {
          data: event, name: event.name, client: event.client, startDate: event.startDate, endDate: event.endDate,
        });
        setEvents((prev) =>
          prev.map((e) =>
            e.id === event.id
              ? { ...e, name: event.name, client: event.client, startDate: event.startDate, endDate: event.endDate }
              : e
          )
        );
        setStatus("saved");
        clearTimeout(statusTimer.current);
        statusTimer.current = setTimeout(() => setStatus("idle"), 1400);
      } catch (e) {
        setStatus("error");
      }
    }, 900);
    return () => clearTimeout(saveTimer.current);
  }, [event]);

  function summary(e) {
    return { id: e.id, name: e.name, client: e.client, startDate: e.startDate, endDate: e.endDate };
  }

  const update = (fn) =>
    setEvent((prev) => {
      const e = clone(prev);
      fn(e);
      return e;
    });

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1900);
  };

  async function switchEvent(id) {
    if (id === currentId) return;
    try {
      const e = normalize(await getEvent(id));
      loadingRef.current = true;
      setCurrentId(id);
      setEvent(e);
      setTab("home");
    } catch (err) {
      flash(err.message || "Couldn't open that show");
    }
  }

  async function newEvent() {
    const name = window.prompt("Name this show:", "New Event");
    if (name === null) return;
    const pw = window.prompt(
      "Set a password for this show (crew use it to open the show).\nLeave blank for no password:",
      ""
    );
    try {
      const e = blankEvent();
      e.name = name || "New Event";
      const created = await createEvent({
        name: e.name, client: e.client, startDate: e.startDate, endDate: e.endDate, data: e, password: pw || "",
      });
      e.id = created.id;
      setEvents((prev) => [...prev, created]);
      loadingRef.current = true;
      setCurrentId(e.id);
      setEvent(e);
      setTab("home");
      flash(pw ? "Show created with password" : "Show created");
    } catch (err) {
      flash(err.message || "Couldn't create show");
    }
  }

  async function duplicateEvent() {
    if (!event) return;
    const e = clone(event);
    e.name = event.name + " (copy)";
    e.time = { days: event.time.days.map((d) => ({ ...d })), entries: {} };
    e.records = [];
    e.diagrams = (e.diagrams || []).map((d) => ({ ...d, id: uid() }));
    try {
      const created = await createEvent({
        name: e.name, client: e.client, startDate: e.startDate, endDate: e.endDate, data: e, password: "",
      });
      e.id = created.id;
      setEvents((prev) => [...prev, created]);
      loadingRef.current = true;
      setCurrentId(e.id);
      setEvent(e);
      setTab("home");
      flash("Duplicated — set its password under Show access");
    } catch (err) {
      flash(err.message || "Couldn't duplicate");
    }
  }

  async function deleteEvent() {
    if (!event) return;
    if (!window.confirm(`Delete "${event.name}"? This removes it for everyone and can't be undone.`)) return;
    try {
      await deleteEvent_api(event.id);
      const next = events.filter((e) => e.id !== event.id);
      setEvents(next);
      if (next.length) {
        const e = normalize(await getEvent(next[0].id));
        loadingRef.current = true;
        setCurrentId(next[0].id);
        setEvent(e);
      } else {
        const seed = blankEvent();
        const created = await createEvent({
          name: seed.name, client: seed.client, startDate: seed.startDate, endDate: seed.endDate, data: seed, password: "",
        });
        seed.id = created.id;
        loadingRef.current = true;
        setEvents([created]);
        setCurrentId(seed.id);
        setEvent(seed);
      }
      setTab("home");
    } catch (err) {
      flash(err.message || "Couldn't delete");
    }
  }

  async function changeShowPassword() {
    const pw = window.prompt(
      "Set a new password for this show.\nLeave blank to remove password protection:",
      ""
    );
    if (pw === null) return;
    try {
      await dbSetPassword(currentId, pw);
      setEvents((prev) => prev.map((e) => (e.id === currentId ? { ...e, hasPassword: !!pw } : e)));
      flash(pw ? "Password updated" : "Password removed");
    } catch (err) {
      flash(err.message || "Couldn't update password");
    }
  }

  function copyBrief() {
    const t = briefText(event);
    try {
      navigator.clipboard.writeText(t);
      flash("Brief copied — paste it to your crew");
    } catch {
      flash("Copy failed on this device");
    }
  }

  if (!ready)
    return (
      <div className="cb">
        <style>{CSS}</style>
        <div className="loading">Loading the callboard…</div>
      </div>
    );
  if (loadError || !event)
    return (
      <div className="cb">
        <style>{CSS}</style>
        <div className="loading">
          {loadError || "No show loaded."}
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={onLogout}>Back to sign in</button>
          </div>
        </div>
      </div>
    );

  const dateRange =
    event.startDate && event.endDate ? `${prettyDate(event.startDate)} – ${prettyDate(event.endDate)}` : "Dates TBD";

  return (
    <div className="cb">
      <style>{CSS}</style>

      {/* top control bar */}
      <div className="topbar">
        <div className="brand">
          <span className="brand-tab">CALL</span>
          <span className="brand-rest">BOARD</span>
        </div>
        {isAdmin ? (
          <>
            <div className="evt-picker">
              <select value={currentId || ""} onChange={(e) => switchEvent(e.target.value)}>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {(e.hasPassword ? "🔒 " : "") + (e.name || "Untitled event")}
                  </option>
                ))}
              </select>
            </div>
            <div className="top-actions">
              <button className="btn" onClick={newEvent}>+ New</button>
              <button className="btn ghost" onClick={duplicateEvent}>Duplicate</button>
              <button className="btn ghost" onClick={changeShowPassword}>Show access</button>
              <button className="btn danger ghost" onClick={deleteEvent}>Delete</button>
            </div>
          </>
        ) : (
          <div className="evt-picker locked">
            <span className="lock-name">{event ? event.name : ""}</span>
          </div>
        )}
        <div className="top-right">
          <div className={"savechip " + status}>
            {status === "saving"
              ? "Saving…"
              : status === "saved"
              ? "Saved ✓"
              : status === "error"
              ? "Save failed"
              : isAdmin
              ? "Admin"
              : "Crew"}
          </div>
          <button className="btn ghost signout" onClick={onLogout} title="Sign out">Sign out</button>
        </div>
      </div>

      {/* body: the home board, or a single section page */}
      {tab === "home" ? (
        <HomeScreen event={event} update={update} go={setTab} copyBrief={copyBrief} dateRange={dateRange} isAdmin={isAdmin} />
      ) : (
        <>
          <div className="pagebar">
            <button className="backbtn" onClick={() => setTab("home")}>
              <span className="chev">‹</span> All sections
            </button>
            <div className="pagebar-title">{SECTION_LABEL[tab] || ""}</div>
            <div className="pagebar-evt" title={event.name}>{event.name}</div>
          </div>
          <main className="content">
            {tab === "brief" && <BriefTab event={event} update={update} />}
            {tab === "schedule" && <ScheduleTab event={event} update={update} isAdmin={isAdmin} />}
            {tab === "documents" && <DocumentsTab event={event} update={update} />}
            {tab === "itinerary" && <ItineraryTab event={event} update={update} />}
            {tab === "notes" && <NotesTab event={event} update={update} />}
            {tab === "audio" && <IOTab event={event} update={update} kind="audio" />}
            {tab === "video" && <IOTab event={event} update={update} kind="video" />}
            {tab === "diagrams" && <DiagramsTab event={event} update={update} />}
            {tab === "pull" && <PullTab event={event} update={update} isAdmin={isAdmin} />}
            {tab === "records" && <RecordsTab event={event} update={update} />}
            {tab === "hours" && <HoursTab event={event} update={update} />}
            {tab === "costing" && isAdmin && <CostingTab event={event} />}
            {tab === "roster" && isAdmin && <RosterTab />}
          </main>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ============================================================
   HOME BOARD — colored tiles that open each section
   ============================================================ */
const SECTIONS = [
  { key: "brief", label: "Brief", desc: "Venue, contacts, crew", color: "#F3B24A" },
  { key: "schedule", label: "Schedule", desc: "Daily run of show", color: "#7E93EC" },
  { key: "documents", label: "Show Documents", desc: "Show flows & agendas", color: "#4EA8DE" },
  { key: "itinerary", label: "Itinerary", desc: "Hotels & flights", color: "#46C5B8" },
  { key: "notes", label: "Meals & Notes", desc: "Catering, pre-con notes", color: "#F0895C" },
  { key: "video", label: "Video I/O", desc: "Video patch sheets", color: "#D97CC0" },
  { key: "audio", label: "Audio I/O", desc: "Audio patch sheets", color: "#9C9AA6" },
  { key: "diagrams", label: "Diagrams", desc: "Stage plots & rigging", color: "#EC6A63" },
  { key: "pull", label: "Pull List", desc: "Gear pull & load-out", color: "#8E7CC3" },
  { key: "records", label: "Records", desc: "Post-show & incidents", color: "#D9B857" },
  { key: "hours", label: "Hours", desc: "Crew timesheet", color: "#6FD08A" },
  { key: "costing", label: "P&L / Costing", desc: "Budget vs actual — admin only", color: "#2E9E7B", adminOnly: true },
  { key: "roster", label: "Labor Roster", desc: "Crew directory — admin only", color: "#7B5EA7", adminOnly: true },
];
const SECTION_LABEL = SECTIONS.reduce((m, s) => ((m[s.key] = s.label), m), {});

function TileIcon({ name }) {
  const p = { width: 30, height: 30, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "brief":
      return (<svg {...p}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9z" /><path d="M8 11h8M8 15h8" /></svg>);
    case "schedule":
      return (<svg {...p}><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></svg>);
    case "documents":
      return (<svg {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3v18M5 9h14M5 15h14" /></svg>);
    case "costing":
      return (<svg {...p}><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>);
    case "roster":
      return (<svg {...p}><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><path d="M19 8v6M22 11h-6"/></svg>);
    case "itinerary":
      return (<svg {...p}><path d="M3 13l18-7-7 18-2.5-7.5L3 13z" /></svg>);
    case "notes":
      return (<svg {...p}><path d="M6 3v8a3 3 0 0 0 6 0V3M9 3v18" /><path d="M17 3c-1.5 1-2 3-2 5s.5 3 2 3v10" /></svg>);
    case "video":
      return (<svg {...p}><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /></svg>);
    case "audio":
      return (<svg {...p}><path d="M6 4v16M12 4v16M18 4v16" /><circle cx="6" cy="9" r="2" /><circle cx="12" cy="15" r="2" /><circle cx="18" cy="8" r="2" /></svg>);
    case "diagrams":
      return (<svg {...p}><path d="M4 19L14 4l6 15z" /><path d="M4 19h16" /></svg>);
    case "pull":
      return (<svg {...p}><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M4 11h16M9 4h6l1 3H8z" /><path d="M9.5 15.5l1.5 1.5 3-3" /></svg>);
    case "records":
      return (<svg {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>);
    case "hours":
      return (<svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>);
    default:
      return null;
  }
}

function tileStat(key, event) {
  switch (key) {
    case "brief": return `${event.crew.length} crew`;
    case "schedule": return `${event.schedule.length} day${event.schedule.length === 1 ? "" : "s"}`;
    case "documents": return `${event.documents.length} doc${event.documents.length === 1 ? "" : "s"}`;
    case "itinerary": return `${event.itinerary.flights.length} flights · ${event.itinerary.stays.length} stays`;
    case "notes": return `${event.notes.length} notes · ${event.meals.length} meals`;
    case "video": return `${event.video.blocks.length} device${event.video.blocks.length === 1 ? "" : "s"}`;
    case "audio": return `${event.audio.blocks.length} device${event.audio.blocks.length === 1 ? "" : "s"}`;
    case "diagrams": return `${event.diagrams.length} file${event.diagrams.length === 1 ? "" : "s"}`;
    case "pull": {
      const all = [...(event.pull?.cases || []).flatMap((c) => c.items), ...(event.pull?.loose || [])];
      const items = all.length;
      const out = all.filter((i) => i.out && !i.in).length;
      return out > 0 ? `${items} items · ${out} out` : `${items} item${items === 1 ? "" : "s"}`;
    }
    case "records": return `${event.records.length} record${event.records.length === 1 ? "" : "s"}`;
    case "hours": {
      let t = 0;
      for (const c of event.crew)
        for (const d of event.time.days) {
          const en = event.time.entries?.[c.id]?.[d.id];
          if (en) t += hoursBetween(en.in, en.out);
        }
      return `${fmtHrs(t)} hrs logged`;
    }
    case "costing": return "Admin only";
    case "roster": return "Admin only";
    default: return "";
  }
}

function HomeScreen({ event, update, go, copyBrief, dateRange, isAdmin }) {
  return (
    <div className="home">
      <header className="hero">
        <div className="hero-main">
          <input
            className="evt-name-input"
            value={event.name}
            onChange={(e) => update((ev) => (ev.name = e.target.value))}
            placeholder="Event name"
          />
          <div className="evt-meta">
            <span>{event.client || "Client TBD"}</span>
            <span className="dot">•</span>
            <span>{dateRange}</span>
            <span className="dot">•</span>
            <span>{event.venue.name || "Venue TBD"}</span>
          </div>
        </div>
        <button className="btn amber copy" onClick={copyBrief}>Copy brief for crew</button>
      </header>

      <div className="board-label">Sections</div>
      <div className="tilegrid">
        {SECTIONS.filter((s) => !s.adminOnly || isAdmin).map((s) => (
          <button key={s.key} className="tile" style={{ background: s.color }} onClick={() => go(s.key)}>
            <span className="tile-ico"><TileIcon name={s.key} /></span>
            <span className="tile-label">{s.label}</span>
            <span className="tile-desc">{s.desc}</span>
            <span className="tile-stat">{tileStat(s.key, event)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   BRIEF TAB — event details, venue, contacts, crew, links
   ============================================================ */
/* ---------- weather (Open-Meteo — free, no API key, browser-side) ---------- */
function wmo(code) {
  const m = {
    0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
    45: ["🌫️", "Fog"], 48: ["🌫️", "Rime fog"],
    51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"],
    56: ["🌧️", "Freezing drizzle"], 57: ["🌧️", "Freezing drizzle"],
    61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
    66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"],
    71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
    80: ["🌦️", "Rain showers"], 81: ["🌧️", "Rain showers"], 82: ["⛈️", "Violent showers"],
    85: ["🌨️", "Snow showers"], 86: ["❄️", "Snow showers"],
    95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm, hail"], 99: ["⛈️", "Severe thunderstorm"],
  };
  return m[code] || ["🌡️", "—"];
}

function WeatherCard({ city, onCity, startDate, endDate }) {
  const [status, setStatus] = useState("loading"); // loading | ok | nogeo | error
  const [geoName, setGeoName] = useState("");
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const q = (city || "").trim();
    if (!q) {
      setStatus("nogeo");
      setData(null);
      return;
    }
    let alive = true;
    setStatus("loading");
    (async () => {
      try {
        const gj = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`
        ).then((r) => r.json());
        const loc = gj.results && gj.results[0];
        if (!loc) {
          if (alive) {
            setStatus("nogeo");
            setData(null);
          }
          return;
        }
        if (!alive) return;
        setGeoName([loc.name, loc.admin1, loc.country_code].filter(Boolean).join(", "));
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
          `&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto&forecast_days=16`;
        const wj = await fetch(url).then((r) => r.json());
        if (alive) {
          setData(wj);
          setStatus("ok");
        }
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [city]);

  const rows = [];
  if (data && data.daily && Array.isArray(data.daily.time)) {
    const t = data.daily.time;
    for (let i = 0; i < t.length; i++) {
      if ((!startDate || t[i] >= startDate) && (!endDate || t[i] <= endDate)) {
        rows.push({
          date: t[i],
          code: data.daily.weather_code[i],
          hi: data.daily.temperature_2m_max[i],
          lo: data.daily.temperature_2m_min[i],
          pop: data.daily.precipitation_probability_max ? data.daily.precipitation_probability_max[i] : null,
        });
      }
    }
  }

  return (
    <Panel
      title="Weather"
      sub={geoName ? "Forecast · " + geoName : "Venue forecast"}
      action={
        <button
          className="add"
          onClick={() => {
            setDraft(city || "");
            setEditing((e) => !e);
          }}
        >
          Change
        </button>
      }
    >
      {editing && (
        <div className="wx-loc">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="City for weather (e.g. San Francisco, CA)" />
          <button
            className="add"
            onClick={() => {
              onCity(draft.trim());
              setEditing(false);
            }}
          >
            Set
          </button>
        </div>
      )}
      {status === "loading" && <Empty>Loading forecast…</Empty>}
      {status === "nogeo" && (
        <Empty>{city ? `Couldn't find “${city}”. Tap Change to set the venue city.` : "Add the venue city (tap Change) to see the forecast."}</Empty>
      )}
      {status === "error" && <Empty>Couldn’t load weather right now.</Empty>}
      {status === "ok" && (
        <>
          {data.current && (
            <div className="wx-now">
              <span className="wx-emoji">{wmo(data.current.weather_code)[0]}</span>
              <span className="wx-nowtemp">{Math.round(data.current.temperature_2m)}°</span>
              <span className="wx-nowlbl">now · {wmo(data.current.weather_code)[1]}</span>
            </div>
          )}
          {rows.length ? (
            <div className="wx-days">
              {rows.map((r) => (
                <div className="wx-day" key={r.date}>
                  <span className="wx-emoji">{wmo(r.code)[0]}</span>
                  <span className="wx-date">{prettyDate(r.date)}</span>
                  <span className="wx-cond">{wmo(r.code)[1]}</span>
                  <span className="wx-temp">{Math.round(r.hi)}° / {Math.round(r.lo)}°</span>
                  <span className="wx-pop">{r.pop != null ? "💧 " + r.pop + "%" : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty>No forecast for the show dates yet — it appears within about 16 days of the event.</Empty>
          )}
          <div className="wx-src">Source: Open-Meteo</div>
        </>
      )}
    </Panel>
  );
}

/* ============================================================
   ROSTER CONTEXT — loads the global crew roster once per session,
   shared by the autocomplete in BriefTab and the RosterTab manager.
   ============================================================ */
/* Normalize roster member positions: handles both old string field and new array field */
const memberPositions = (data) =>
  Array.isArray(data?.positions) ? data.positions :
  (data?.position ? [data.position] : []);
  "Show Caller","Production Manager","Stage Manager",
  "Technical Director","Video Director",
  "Audio Engineer (A1)","Monitor Engineer (A2)",
  "Camera Operator","Camera TD","Graphics Operator",
  "Lighting Designer","Lighting Tech","LED Tech",
  "Record Op","Playback Operator",
  "Rigging Supervisor","Rigger",
];

const RosterCtx = React.createContext({ roster: [], positions: ROSTER_DEFAULT_POSITIONS, reload: () => {}, reloadPositions: () => {}, loading: false });

function RosterProvider({ children }) {
  const [roster, setRoster] = useState([]);
  const [positions, setPositions] = useState(ROSTER_DEFAULT_POSITIONS);
  const [loading, setLoading] = useState(false);
  const loaded = useRef(false);
  const reload = async () => {
    setLoading(true);
    try {
      const [list, posData] = await Promise.all([listRoster(), getPositions()]);
      setRoster(list);
      if (posData.positions?.length) setPositions(posData.positions);
      loaded.current = true;
    } catch { /* silently — roster is non-critical */ }
    finally { setLoading(false); }
  };
  const reloadPositions = async () => {
    try { const d = await getPositions(); if (d.positions?.length) setPositions(d.positions); } catch {}
  };
  useEffect(() => { if (!loaded.current) reload(); }, []);
  return <RosterCtx.Provider value={{ roster, positions, reload, reloadPositions, loading }}>{children}</RosterCtx.Provider>;
}

/* Autocomplete input for crew name field */
function CrewNameInput({ value, onChange, onSelect }) {
  const { roster } = React.useContext(RosterCtx);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const q = value.trim().toLowerCase();
  const matches = q.length > 0
    ? roster.filter((r) => r.name.toLowerCase().includes(q) && r.name.toLowerCase() !== q).slice(0, 7)
    : [];
  return (
    <div className="crew-ac-wrap" ref={ref}>
      <input
        value={value}
        placeholder="Name"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="crew-ac-drop">
          {matches.map((m) => (
            <button key={m.id} className="crew-ac-row" onMouseDown={() => { onSelect(m); setOpen(false); }}>
              <span className="crew-ac-name">{m.name}</span>
              <span className="crew-ac-pos">{memberPositions(m.data).join(", ") || ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BriefTab({ event, update }) {
  const [emailsCopied, setEmailsCopied] = useState(false);
  const copyEmails = () => {
    const emails = event.crew.map((c) => c.email).filter(Boolean).join(", ");
    if (!emails) return;
    navigator.clipboard?.writeText(emails).catch(() => {});
    setEmailsCopied(true);
    setTimeout(() => setEmailsCopied(false), 2000);
  };
  return (
    <div className="stack">
      <Panel title="Event details">
        <div className="grid2">
          <Field label="Client">
            <input value={event.client} onChange={(e) => update((ev) => (ev.client = e.target.value))} placeholder="Client name" />
          </Field>
          <Field label="Venue">
            <input value={event.venue.name} onChange={(e) => update((ev) => (ev.venue.name = e.target.value))} placeholder="Venue name" />
          </Field>
          <Field label="Start date">
            <input type="date" value={event.startDate} onChange={(e) => update((ev) => (ev.startDate = e.target.value))} />
          </Field>
          <Field label="End date">
            <input type="date" value={event.endDate} onChange={(e) => update((ev) => (ev.endDate = e.target.value))} />
          </Field>
          <Field label="Venue address">
            <input value={event.venue.address} onChange={(e) => update((ev) => (ev.venue.address = e.target.value))} placeholder="Street, city, state" />
          </Field>
          <Field label="Map link">
            <input value={event.venue.mapLink} onChange={(e) => update((ev) => (ev.venue.mapLink = e.target.value))} placeholder="https://…" />
          </Field>
        </div>
      </Panel>

      <WeatherCard
        city={event.venue.weatherCity || event.venue.address || event.venue.name || ""}
        onCity={(v) => update((ev) => (ev.venue.weatherCity = v))}
        startDate={event.startDate}
        endDate={event.endDate}
      />

      <Panel
        title="Key contacts"
        sub="Production, venue, client, vendors"
        action={
          <AddBtn
            onClick={() =>
              update((ev) => ev.contacts.push({ id: uid(), role: "", name: "", phone: "", email: "" }))
            }
          >
            Contact
          </AddBtn>
        }
      >
        <div className="rows">
          <div className="rowhead contact-grid">
            <span>Role</span><span>Name</span><span>Phone</span><span>Email</span><span />
          </div>
          {event.contacts.map((c, i) => (
            <div className="row contact-grid" key={c.id}>
              <input value={c.role} placeholder="Role" onChange={(e) => update((ev) => (ev.contacts[i].role = e.target.value))} />
              <input value={c.name} placeholder="Name" onChange={(e) => update((ev) => (ev.contacts[i].name = e.target.value))} />
              <input value={c.phone} placeholder="Phone" onChange={(e) => update((ev) => (ev.contacts[i].phone = e.target.value))} />
              <input value={c.email} placeholder="Email" onChange={(e) => update((ev) => (ev.contacts[i].email = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.contacts.splice(i, 1))} />
            </div>
          ))}
          {!event.contacts.length && <Empty>No contacts yet. Add your PM, venue CSM, and client.</Empty>}
        </div>
      </Panel>

      <Panel
        title="Crew roster"
        sub="These people also appear in the Hours timesheet"
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {event.crew.some((c) => c.email) && (
              <button className="copy-emails-btn" onClick={copyEmails}>
                {emailsCopied ? "✓ Copied!" : "Copy emails"}
              </button>
            )}
            <AddBtn
              onClick={() =>
                update((ev) => ev.crew.push({ id: uid(), name: "", position: "", phone: "", email: "" }))
              }
            >
              Crew member
            </AddBtn>
          </div>
        }
      >
        <div className="rows">
          <div className="rowhead crew-grid">
            <span>Name</span><span>Position</span><span>Phone</span><span>Email</span><span />
          </div>
          {event.crew.map((c, i) => (
            <div className="row crew-grid" key={c.id}>
              <CrewNameInput
                value={c.name}
                onChange={(v) => update((ev) => (ev.crew[i].name = v))}
                onSelect={(r) => update((ev) => {
                  const d = r.data || {};
                  ev.crew[i].name = r.name;
                  ev.crew[i].rosterId = r.id;
                  const pos = memberPositions(d)[0] || d.position || "";
                  if (pos) ev.crew[i].position = pos;
                  if (d.phone) ev.crew[i].phone = d.phone;
                  if (d.email) ev.crew[i].email = d.email;
                  if (d.rateType) ev.crew[i].rateType = d.rateType;
                  if (d.rate) ev.crew[i].rate = d.rate;
                })}
              />
              <input value={c.position} placeholder="Position" onChange={(e) => update((ev) => (ev.crew[i].position = e.target.value))} />
              <input value={c.phone} placeholder="Phone" onChange={(e) => update((ev) => (ev.crew[i].phone = e.target.value))} />
              <input value={c.email} placeholder="Email" onChange={(e) => update((ev) => (ev.crew[i].email = e.target.value))} />
              <div className="row-tools">
                <button
                  className="movebtn"
                  title="Move up"
                  disabled={i === 0}
                  onClick={() =>
                    update((ev) => {
                      const a = ev.crew;
                      const t = a[i - 1];
                      a[i - 1] = a[i];
                      a[i] = t;
                    })
                  }
                >
                  ▲
                </button>
                <button
                  className="movebtn"
                  title="Move down"
                  disabled={i === event.crew.length - 1}
                  onClick={() =>
                    update((ev) => {
                      const a = ev.crew;
                      const t = a[i + 1];
                      a[i + 1] = a[i];
                      a[i] = t;
                    })
                  }
                >
                  ▼
                </button>
                <RemoveBtn onClick={() => update((ev) => ev.crew.splice(i, 1))} />
              </div>
            </div>
          ))}
          {!event.crew.length && <Empty>No crew yet. Add people here — they’ll show up in Hours automatically.</Empty>}
        </div>
      </Panel>

      <div className="grid2 top">
        <Panel
          title="Wardrobe"
          action={null}
        >
          <textarea
            className="area"
            rows={5}
            value={event.wardrobe}
            placeholder="Dress code, logos, what to bring…"
            onChange={(e) => update((ev) => (ev.wardrobe = e.target.value))}
          />
        </Panel>

        <Panel
          title="Links"
          action={<AddBtn onClick={() => update((ev) => ev.links.push({ id: uid(), label: "", url: "" }))}>Link</AddBtn>}
        >
          <div className="rows">
            {event.links.map((l, i) => (
              <div className="row link-grid" key={l.id}>
                <input value={l.label} placeholder="Label" onChange={(e) => update((ev) => (ev.links[i].label = e.target.value))} />
                <input value={l.url} placeholder="https://…" onChange={(e) => update((ev) => (ev.links[i].url = e.target.value))} />
                <RemoveBtn onClick={() => update((ev) => ev.links.splice(i, 1))} />
              </div>
            ))}
            {!event.links.length && <Empty>Add links to schedules, gear lists, diagrams.</Empty>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ============================================================
   SCHEDULE TAB — daily run of show
   ============================================================ */
/* ---------- schedule time sorting ----------
   Parse the free-text Time field into minutes-since-midnight so lines can be
   ordered chronologically. Handles "6:00 AM", "6am", "0600", "600", "13:30", "6". */
function schedMinutes(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  let mer = null;
  const m = s.match(/(a|p)m?\.?$/);
  if (m) {
    mer = m[1];
    s = s.slice(0, m.index);
  }
  let h, min;
  if (s.includes(":")) {
    const [hh, mm = ""] = s.split(":");
    h = parseInt(hh, 10);
    min = parseInt(mm || "0", 10);
  } else if (/^\d{3,4}$/.test(s)) {
    h = parseInt(s.slice(0, s.length - 2), 10);
    min = parseInt(s.slice(-2), 10);
  } else if (/^\d{1,2}$/.test(s)) {
    h = parseInt(s, 10);
    min = 0;
  } else {
    return null;
  }
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  if (mer === "p" && h < 12) h += 12;
  if (mer === "a" && h === 12) h = 0;
  if (h === 24 && min === 0) return 24 * 60;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
/* stable sort: earliest first; blank/unparseable times fall to the bottom in place */
function sortSchedItems(items) {
  return items
    .map((it, i) => ({ it, i, m: schedMinutes(it.time) }))
    .sort((a, b) => {
      if (a.m == null && b.m == null) return a.i - b.i;
      if (a.m == null) return 1;
      if (b.m == null) return -1;
      return a.m !== b.m ? a.m - b.m : a.i - b.i;
    })
    .map((x) => x.it);
}
/* canonical display, e.g. "6:00 PM"; leaves blanks/unparseable ("TBD") as typed */
function fmtSchedTime(raw) {
  const mins = schedMinutes(raw);
  if (mins == null) return raw;
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const mer = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return h12 + ":" + String(m).padStart(2, "0") + " " + mer;
}
/* normalize every time in a day to the canonical format, then order chronologically */
function tidySchedDay(items) {
  return sortSchedItems(items.map((it) => ({ ...it, time: fmtSchedTime(it.time) })));
}

function ScheduleTab({ event, update, isAdmin }) {
  const unlocked = !!event.scheduleUnlocked;
  const canEdit = isAdmin || unlocked;
  const addDay = () =>
    update((ev) =>
      ev.schedule.push({ id: uid(), label: "New day", date: ev.startDate, items: [{ id: uid(), time: "", activity: "" }] })
    );
  return (
    <div className="stack">
      {/* lock bar */}
      <div className="pl-bar">
        <div className="pl-lockwrap">
          {isAdmin ? (
            <button className={"pl-lock " + (unlocked ? "open" : "")} onClick={() => update((ev) => (ev.scheduleUnlocked = !unlocked))}>
              {unlocked ? "🔓 Crew editing ON" : "🔒 Crew editing OFF"}
            </button>
          ) : unlocked ? (
            <span className="pl-locknote open">🔓 Editing unlocked by admin</span>
          ) : (
            <span className="pl-locknote">🔒 Schedule locked — view only</span>
          )}
          {isAdmin && (
            <span className="pl-lockhint">
              {unlocked ? "Any crew on this show can edit the schedule." : "Only you (admin) can edit the schedule."}
            </span>
          )}
        </div>
      </div>

      <div className="tab-lead">
        <p>Daily run of show. Add a day for each date, then list call times and activities.</p>
        {canEdit && <AddBtn onClick={addDay}>Day</AddBtn>}
      </div>

      {event.schedule.map((day, di) =>
        canEdit ? (
          <Panel
            key={day.id}
            title={
              <input
                className="daytitle"
                value={day.label}
                onChange={(e) => update((ev) => (ev.schedule[di].label = e.target.value))}
                placeholder="Day label"
              />
            }
            action={
              <div className="day-tools">
                <button
                  className="daysort"
                  type="button"
                  title="Sort this day's lines by time"
                  onClick={() => update((ev) => (ev.schedule[di].items = tidySchedDay(ev.schedule[di].items)))}
                >
                  ↕ Time
                </button>
                <input
                  type="date"
                  className="daydate"
                  value={day.date || ""}
                  onChange={(e) => update((ev) => (ev.schedule[di].date = e.target.value))}
                />
                <RemoveBtn title="Remove day" onClick={() => update((ev) => ev.schedule.splice(di, 1))} />
              </div>
            }
          >
            <div className="rows">
              {day.items.map((it, ii) => (
                <div className="row sched-grid" key={it.id}>
                  <input
                    className="time-in-text"
                    value={it.time}
                    placeholder="Time"
                    onChange={(e) => update((ev) => (ev.schedule[di].items[ii].time = e.target.value))}
                    onBlur={() => update((ev) => (ev.schedule[di].items = tidySchedDay(ev.schedule[di].items)))}
                  />
                  <input
                    value={it.activity}
                    placeholder="Activity"
                    onChange={(e) => update((ev) => (ev.schedule[di].items[ii].activity = e.target.value))}
                  />
                  <RemoveBtn onClick={() => update((ev) => ev.schedule[di].items.splice(ii, 1))} />
                </div>
              ))}
            </div>
            <AddBtn onClick={() => update((ev) => ev.schedule[di].items.push({ id: uid(), time: "", activity: "" }))}>
              Line
            </AddBtn>
          </Panel>
        ) : (
          <Panel
            key={day.id}
            title={<span className="daytitle-ro">{day.label || "Untitled day"}</span>}
            action={day.date ? <span className="daydate-ro">{prettyDate(day.date)}</span> : null}
          >
            <div className="sched-ro">
              {day.items.length ? (
                day.items.map((it) => (
                  <div className="sched-ro-row" key={it.id}>
                    <span className="sched-ro-time">{it.time || "—"}</span>
                    <span className="sched-ro-act">{it.activity || ""}</span>
                  </div>
                ))
              ) : (
                <Empty>No lines yet.</Empty>
              )}
            </div>
          </Panel>
        )
      )}
      {!event.schedule.length && (
        <Panel title="Run of show">
          <Empty>{canEdit ? "No days yet. Add your first day to start the schedule." : "No schedule posted yet."}</Empty>
        </Panel>
      )}
    </div>
  );
}

/* ============================================================
   ITINERARY TAB — hotels + flights
   ============================================================ */
function CrewSelect({ crew, value, onChange }) {
  const named = crew.filter((c) => c.name);
  const missing = value && !named.some((c) => c.name === value);
  return (
    <select value={value || ""} onChange={onChange}>
      <option value="">— Crew member —</option>
      {named.map((c) => (
        <option key={c.id} value={c.name}>
          {c.name}
        </option>
      ))}
      {missing && <option value={value}>{value}</option>}
    </select>
  );
}

function ItineraryTab({ event, update }) {
  const it = event.itinerary;
  const addAllCrewStays = () =>
    update((ev) => {
      const have = new Set(ev.itinerary.stays.map((s) => s.crewName).filter(Boolean));
      ev.crew.forEach((c) => {
        if (c.name && !have.has(c.name)) {
          ev.itinerary.stays.push({ id: uid(), crewName: c.name, checkIn: ev.startDate, checkOut: ev.endDate, confirmation: "", notes: "" });
        }
      });
    });
  return (
    <div className="stack">
      <Panel title="Hotel">
        <div className="grid2">
          <Field label="Hotel">
            <input value={it.hotelName} placeholder="Hotel name" onChange={(e) => update((ev) => (ev.itinerary.hotelName = e.target.value))} />
          </Field>
          <Field label="Address">
            <input value={it.hotelAddress} placeholder="Address" onChange={(e) => update((ev) => (ev.itinerary.hotelAddress = e.target.value))} />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Room stays"
        action={
          <div className="panel-actions">
            <AddBtn onClick={addAllCrewStays}>All crew</AddBtn>
            <AddBtn
              onClick={() =>
                update((ev) =>
                  ev.itinerary.stays.push({ id: uid(), crewName: "", checkIn: ev.startDate, checkOut: ev.endDate, confirmation: "", notes: "" })
                )
              }
            >
              Stay
            </AddBtn>
          </div>
        }
      >
        <div className="rows">
          <div className="rowhead stay-grid">
            <span>Name</span><span>Check-in</span><span>Check-out</span><span>Conf #</span><span>Notes</span><span />
          </div>
          {it.stays.map((s, i) => (
            <div className="row stay-grid" key={s.id}>
              <CrewSelect crew={event.crew} value={s.crewName} onChange={(e) => update((ev) => (ev.itinerary.stays[i].crewName = e.target.value))} />
              <input type="date" value={s.checkIn || ""} onChange={(e) => update((ev) => (ev.itinerary.stays[i].checkIn = e.target.value))} />
              <input type="date" value={s.checkOut || ""} onChange={(e) => update((ev) => (ev.itinerary.stays[i].checkOut = e.target.value))} />
              <input value={s.confirmation} placeholder="Conf" onChange={(e) => update((ev) => (ev.itinerary.stays[i].confirmation = e.target.value))} />
              <input value={s.notes} placeholder="Notes" onChange={(e) => update((ev) => (ev.itinerary.stays[i].notes = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.itinerary.stays.splice(i, 1))} />
            </div>
          ))}
          {!it.stays.length && <Empty>No room stays yet.</Empty>}
        </div>
      </Panel>

      <Panel
        title="Flights"
        sub="For flight changes, route through your travel coordinator"
        action={
          <AddBtn
            onClick={() =>
              update((ev) =>
                ev.itinerary.flights.push({ id: uid(), crewName: "", date: ev.startDate, airport: "", flightNo: "", depart: "", arrive: "", confirmation: "", notes: "" })
              )
            }
          >
            Flight
          </AddBtn>
        }
      >
        <div className="rows scroll-x">
          <div className="rowhead flight-grid">
            <span>Name</span><span>Date</span><span>Route</span><span>Flight</span><span>Depart</span><span>Arrive</span><span>Conf</span><span>Notes</span><span />
          </div>
          {it.flights.map((f, i) => (
            <div className="row flight-grid" key={f.id}>
              <CrewSelect crew={event.crew} value={f.crewName} onChange={(e) => update((ev) => (ev.itinerary.flights[i].crewName = e.target.value))} />
              <input type="date" value={f.date || ""} onChange={(e) => update((ev) => (ev.itinerary.flights[i].date = e.target.value))} />
              <input value={f.airport} placeholder="A → B" onChange={(e) => update((ev) => (ev.itinerary.flights[i].airport = e.target.value))} />
              <input value={f.flightNo} placeholder="DL0000" onChange={(e) => update((ev) => (ev.itinerary.flights[i].flightNo = e.target.value))} />
              <input type="time" value={f.depart || ""} onChange={(e) => update((ev) => (ev.itinerary.flights[i].depart = e.target.value))} />
              <input type="time" value={f.arrive || ""} onChange={(e) => update((ev) => (ev.itinerary.flights[i].arrive = e.target.value))} />
              <input value={f.confirmation} placeholder="Conf" onChange={(e) => update((ev) => (ev.itinerary.flights[i].confirmation = e.target.value))} />
              <input value={f.notes} placeholder="Notes" onChange={(e) => update((ev) => (ev.itinerary.flights[i].notes = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.itinerary.flights.splice(i, 1))} />
            </div>
          ))}
          {!it.flights.length && <Empty>No flights yet.</Empty>}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   MEALS & NOTES TAB
   ============================================================ */
function NotesTab({ event, update }) {
  return (
    <div className="stack">
      <Panel
        title="Meals"
        action={
          <AddBtn onClick={() => update((ev) => ev.meals.push({ id: uid(), date: ev.startDate, time: "", type: "", link: "" }))}>
            Meal
          </AddBtn>
        }
      >
        <div className="rows">
          <div className="rowhead meal-grid">
            <span>Date</span><span>Time</span><span>Meal</span><span>Link</span><span />
          </div>
          {event.meals.map((m, i) => (
            <div className="row meal-grid" key={m.id}>
              <input type="date" value={m.date || ""} onChange={(e) => update((ev) => (ev.meals[i].date = e.target.value))} />
              <input value={m.time} placeholder="Time" onChange={(e) => update((ev) => (ev.meals[i].time = e.target.value))} />
              <input value={m.type} placeholder="Breakfast / lunch / dinner" onChange={(e) => update((ev) => (ev.meals[i].type = e.target.value))} />
              <input value={m.link} placeholder="Menu link" onChange={(e) => update((ev) => (ev.meals[i].link = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.meals.splice(i, 1))} />
            </div>
          ))}
          {!event.meals.length && <Empty>No meals scheduled.</Empty>}
        </div>
      </Panel>

      <Panel
        title="Notes"
        sub="Pre-con notes, gear reminders, changes"
        action={<AddBtn onClick={() => update((ev) => ev.notes.push({ id: uid(), date: new Date().toISOString().slice(0, 10), text: "" }))}>Note</AddBtn>}
      >
        <div className="rows">
          {event.notes.map((n, i) => (
            <div className="row note-grid" key={n.id}>
              <input type="date" value={n.date || ""} onChange={(e) => update((ev) => (ev.notes[i].date = e.target.value))} />
              <input value={n.text} placeholder="Note" onChange={(e) => update((ev) => (ev.notes[i].text = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.notes.splice(i, 1))} />
            </div>
          ))}
          {!event.notes.length && <Empty>No notes yet.</Empty>}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   AUDIO / VIDEO I/O TAB — patch sheets (one or more devices)
   ============================================================ */
function IOList({ event, update, kind, block, bi, side }) {
  // side: "ins" (Source) or "outs" (Destination)
  const rows = block[side];
  const label = side === "ins" ? "Source" : "Destination";
  const addRow = () =>
    update((ev) => ev[kind].blocks[bi][side].push(ioRow(rows.length + 1)));
  return (
    <div className="io-side">
      <div className="io-side-h">{side === "ins" ? "Inputs" : "Outputs"}</div>
      <div className="rows scroll-x">
        <div className="rowhead io-grid">
          <span>#</span><span>{label}</span><span>Patch</span><span>Signal</span><span>Notes</span><span />
        </div>
        {rows.map((r, ri) => (
          <div className="row io-grid" key={r.id}>
            <input className="io-num" value={r.num} onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].num = e.target.value))} />
            <input value={r.name} placeholder={label} onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].name = e.target.value))} />
            <input value={r.patch} placeholder="Patch" onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].patch = e.target.value))} />
            <input value={r.signal} placeholder="Signal" onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].signal = e.target.value))} />
            <input value={r.notes} placeholder="Notes" onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].notes = e.target.value))} />
            <RemoveBtn onClick={() => update((ev) => ev[kind].blocks[bi][side].splice(ri, 1))} />
          </div>
        ))}
        {!rows.length && <Empty>No {side === "ins" ? "inputs" : "outputs"} yet.</Empty>}
      </div>
      <AddBtn onClick={addRow}>{side === "ins" ? "Input" : "Output"}</AddBtn>
    </div>
  );
}

function IOTab({ event, update, kind }) {
  const data = event[kind];
  const title = kind === "audio" ? "Audio" : "Video";
  const addBlock = () => update((ev) => ev[kind].blocks.push(ioBlock("New device")));
  return (
    <div className="stack">
      <div className="tab-lead">
        <p>{title} in / out patch. Add a device for each console, switcher, or processor, then list its inputs and outputs.</p>
        <AddBtn onClick={addBlock}>Device</AddBtn>
      </div>

      {data.blocks.map((block, bi) => (
        <Panel
          key={block.id}
          title={
            <input
              className="daytitle"
              value={block.name}
              placeholder="Device / console"
              onChange={(e) => update((ev) => (ev[kind].blocks[bi].name = e.target.value))}
            />
          }
          action={<RemoveBtn title="Remove device" onClick={() => update((ev) => ev[kind].blocks.splice(bi, 1))} />}
        >
          <div className="io-cols">
            <IOList event={event} update={update} kind={kind} block={block} bi={bi} side="ins" />
            <IOList event={event} update={update} kind={kind} block={block} bi={bi} side="outs" />
          </div>
        </Panel>
      ))}
      {!data.blocks.length && (
        <Panel title={title + " I/O"}>
          <Empty>No devices yet. Add one to start the patch sheet.</Empty>
        </Panel>
      )}
    </div>
  );
}

/* ============================================================
   DIAGRAMS TAB — upload images or link hosted files
   ============================================================ */
/* ---------- inline preview for linked files (Google Sheets/Docs/Slides, Drive, images, PDFs) ---------- */
function embedFor(url) {
  if (!url) return null;
  const u = url.trim();
  let m = u.match(/https?:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return { kind: "iframe", src: `https://docs.google.com/${m[1]}/d/${m[2]}/preview` };
  m = u.match(/https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return { kind: "iframe", src: `https://drive.google.com/file/d/${m[1]}/preview` };
  m = u.match(/https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);
  if (m) return { kind: "iframe", src: `https://drive.google.com/file/d/${m[1]}/preview` };
  if (/dropbox\.com/.test(u)) {
    const d = u.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/([?&])dl=\d/, "$1raw=1");
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(d)) return { kind: "image", src: d };
    return { kind: "iframe", src: d };
  }
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u)) return { kind: "image", src: u };
  return { kind: "iframe", src: u };
}

function LinkPreview({ url, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!url) return null;
  const info = embedFor(url);
  return (
    <div className="linkprev">
      <button className="previewbtn" type="button" onClick={() => setOpen((o) => !o)}>
        {open ? "▾ Hide preview" : "▸ Preview"}
      </button>
      {open && info && (
        <div className="linkprev-frame">
          {info.kind === "image" ? (
            <img src={info.src} alt="Preview" />
          ) : (
            <iframe src={info.src} title="Preview" loading="lazy" allowFullScreen />
          )}
          <div className="linkprev-note">
            If the preview is blank, the file may not allow embedding — use Open ↗. Google files must be shared “anyone with the link.”
          </div>
        </div>
      )}
    </div>
  );
}

function DiagramsTab({ event, update }) {
  const addLink = () =>
    update((ev) => ev.diagrams.push({ id: uid(), name: "", caption: "", kind: "link", url: "" }));
  return (
    <div className="stack">
      <div className="tab-lead">
        <p>
          Link your diagrams — stage plots, rigging, signal flow. Host the file (Google Drive, Dropbox,
          Vectorworks Cloud…), set sharing to “anyone with the link,” and paste it here so the whole crew can open it.
        </p>
        <AddBtn onClick={addLink}>Diagram link</AddBtn>
      </div>
      <Panel title="Diagrams">
        <div className="rows">
          <div className="rowhead diagramlink-grid">
            <span>Name</span><span>Link</span><span>Caption</span><span />
          </div>
          {event.diagrams.map((d, i) => (
            <div className="linkrow" key={d.id}>
              <div className="row diagramlink-grid">
                <input value={d.name} placeholder="Diagram name" onChange={(e) => update((ev) => (ev.diagrams[i].name = e.target.value))} />
                <input
                  value={d.url || ""}
                  placeholder="https://…"
                  onChange={(e) =>
                    update((ev) => {
                      ev.diagrams[i].url = e.target.value;
                      ev.diagrams[i].kind = "link";
                    })
                  }
                />
                <input value={d.caption} placeholder="Caption (optional)" onChange={(e) => update((ev) => (ev.diagrams[i].caption = e.target.value))} />
                <div className="diagram-open">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer">Open ↗</a>
                  ) : (
                    <span className="dim">—</span>
                  )}
                  <RemoveBtn onClick={() => update((ev) => ev.diagrams.splice(i, 1))} />
                </div>
              </div>
              <LinkPreview url={d.url} />
            </div>
          ))}
          {!event.diagrams.length && <Empty>No diagrams yet. Add a link to a hosted stage plot or rigging file.</Empty>}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   SHOW DOCUMENTS TAB — link show flows & agendas (Google Sheets, etc.)
   ============================================================ */
function DocumentsTab({ event, update }) {
  const addDoc = () =>
    update((ev) => ev.documents.push({ id: uid(), name: "", category: "Show Flow", url: "", notes: "" }));
  return (
    <div className="stack">
      <div className="tab-lead">
        <p>
          Link your show flows and agendas. In Google Sheets, hit <b>Share → General access → “Anyone with the link”</b>,
          copy the link, and paste it here so the whole crew can open the live sheet.
        </p>
        <AddBtn onClick={addDoc}>Document link</AddBtn>
      </div>
      <Panel title="Show documents" sub="Show flows, agendas, and other shared sheets">
        <div className="rows">
          <div className="rowhead doclink-grid">
            <span>Name</span><span>Type</span><span>Link</span><span>Notes</span><span />
          </div>
          {event.documents.map((d, i) => (
            <div className="linkrow" key={d.id}>
              <div className="row doclink-grid">
                <input
                  value={d.name}
                  placeholder="e.g. Day 2 Show Flow"
                  onChange={(e) => update((ev) => (ev.documents[i].name = e.target.value))}
                />
                <select value={d.category || "Show Flow"} onChange={(e) => update((ev) => (ev.documents[i].category = e.target.value))}>
                  <option>Show Flow</option>
                  <option>Agenda</option>
                  <option>Other</option>
                </select>
                <input
                  value={d.url || ""}
                  placeholder="https://docs.google.com/…"
                  onChange={(e) => update((ev) => (ev.documents[i].url = e.target.value))}
                />
                <input
                  value={d.notes || ""}
                  placeholder="Notes (optional)"
                  onChange={(e) => update((ev) => (ev.documents[i].notes = e.target.value))}
                />
                <div className="diagram-open">
                  <button
                    className="movebtn"
                    title="Move up"
                    type="button"
                    disabled={i === 0}
                    onClick={() =>
                      update((ev) => {
                        const a = ev.documents;
                        const t = a[i - 1];
                        a[i - 1] = a[i];
                        a[i] = t;
                      })
                    }
                  >
                    ▲
                  </button>
                  <button
                    className="movebtn"
                    title="Move down"
                    type="button"
                    disabled={i === event.documents.length - 1}
                    onClick={() =>
                      update((ev) => {
                        const a = ev.documents;
                        const t = a[i + 1];
                        a[i + 1] = a[i];
                        a[i] = t;
                      })
                    }
                  >
                    ▼
                  </button>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer">Open ↗</a>
                  ) : (
                    <span className="dim">—</span>
                  )}
                  <RemoveBtn onClick={() => update((ev) => ev.documents.splice(i, 1))} />
                </div>
              </div>
              <LinkPreview url={d.url} defaultOpen={i === 0} />
            </div>
          ))}
          {!event.documents.length && (
            <Empty>No documents yet. Add a link to a Google Sheet show flow or agenda.</Empty>
          )}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   RECORDS TAB — post-show notes, damage/loss, sign-offs
   ============================================================ */
function RecordsTab({ event, update }) {
  const add = () =>
    update((ev) =>
      ev.records.push({ id: uid(), date: new Date().toISOString().slice(0, 10), crew: "", type: "Post-show note", text: "" })
    );
  return (
    <div className="stack">
      <div className="tab-lead">
        <p>A running log for the show: post-show notes, damage or loss, incidents, and sign-offs the crew wants on record.</p>
        <AddBtn onClick={add}>Record</AddBtn>
      </div>
      <datalist id="record-types">
        <option value="Post-show note" />
        <option value="Damage / loss" />
        <option value="Incident" />
        <option value="Sign-off" />
        <option value="Gear repair" />
      </datalist>
      <Panel title="Records">
        <div className="rows">
          <div className="rowhead record-grid">
            <span>Date</span><span>Crew member</span><span>Type</span><span>Details</span><span />
          </div>
          {event.records.map((r, i) => (
            <div className="row record-grid" key={r.id}>
              <input type="date" value={r.date || ""} onChange={(e) => update((ev) => (ev.records[i].date = e.target.value))} />
              <input value={r.crew} placeholder="Name" onChange={(e) => update((ev) => (ev.records[i].crew = e.target.value))} />
              <input list="record-types" value={r.type} placeholder="Type" onChange={(e) => update((ev) => (ev.records[i].type = e.target.value))} />
              <input value={r.text} placeholder="What happened / what to note" onChange={(e) => update((ev) => (ev.records[i].text = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev.records.splice(i, 1))} />
            </div>
          ))}
          {!event.records.length && <Empty>No records yet. Add post-show notes or anything the team should log.</Empty>}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   HOURS TAB — timesheet
   ============================================================ */
function HoursTab({ event, update }) {
  const days = event.time.days;
  const crew = event.crew;

  const setTime = (crewId, dayId, field, val) =>
    update((ev) => {
      if (!ev.time.entries[crewId]) ev.time.entries[crewId] = {};
      if (!ev.time.entries[crewId][dayId]) ev.time.entries[crewId][dayId] = { in: "", out: "" };
      ev.time.entries[crewId][dayId][field] = val;
    });

  const entry = (crewId, dayId) => event.time.entries?.[crewId]?.[dayId] || { in: "", out: "" };
  const personTotal = (crewId) => days.reduce((s, d) => s + hoursBetween(entry(crewId, d.id).in, entry(crewId, d.id).out), 0);
  const dayTotal = (dayId) => crew.reduce((s, c) => s + hoursBetween(entry(c.id, dayId).in, entry(c.id, dayId).out), 0);
  const grand = crew.reduce((s, c) => s + personTotal(c.id), 0);
  const personTiers = (crewId) =>
    days.reduce(
      (acc, d) => {
        const b = otBreakdown(hoursBetween(entry(crewId, d.id).in, entry(crewId, d.id).out));
        acc.reg += b.reg;
        acc.ot += b.ot;
        acc.dt += b.dt;
        return acc;
      },
      { reg: 0, ot: 0, dt: 0 }
    );
  const grandTiers = crew.reduce(
    (acc, c) => {
      const t = personTiers(c.id);
      acc.reg += t.reg;
      acc.ot += t.ot;
      acc.dt += t.dt;
      return acc;
    },
    { reg: 0, ot: 0, dt: 0 }
  );

  const addDay = () => {
    const n = days.length + 1;
    update((ev) => ev.time.days.push({ id: uid(), label: "Day " + n }));
  };

  if (!crew.length)
    return (
      <Panel title="Hours">
        <Empty>Add crew members on the Brief tab first — they’ll appear here as timesheet rows.</Empty>
      </Panel>
    );

  return (
    <div className="stack">
      <div className="tab-lead">
        <p>Enter time in / out for each person, per day. Hours calculate automatically — overnight shifts included.</p>
        <AddBtn onClick={addDay}>Day</AddBtn>
      </div>

      <div className="ts-wrap">
        <table className="timesheet">
          <thead>
            <tr>
              <th className="sticky-col name-col">Crew</th>
              {days.map((d, di) => (
                <th key={d.id} className="day-col" colSpan={3}>
                  <div className="day-head">
                    <input
                      className="daylabel"
                      value={d.label}
                      onChange={(e) => update((ev) => (ev.time.days[di].label = e.target.value))}
                    />
                    <button className="remove sm" title="Remove day" onClick={() => update((ev) => ev.time.days.splice(di, 1))}>×</button>
                  </div>
                </th>
              ))}
              <th className="total-col">Total</th>
            </tr>
            <tr className="subhead">
              <th className="sticky-col name-col" />
              {days.map((d) => (
                <React.Fragment key={d.id}>
                  <th>In</th>
                  <th>Out</th>
                  <th>Hrs</th>
                </React.Fragment>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {crew.map((c) => (
              <tr key={c.id}>
                <td className="sticky-col name-col">
                  <div className="crew-name">{c.name || "—"}</div>
                  <div className="crew-pos">{c.position}</div>
                </td>
                {days.map((d) => {
                  const en = entry(c.id, d.id);
                  const h = hoursBetween(en.in, en.out);
                  return (
                    <React.Fragment key={d.id}>
                      <td>
                        <input className="time-in-text" value={en.in} placeholder="In" onChange={(e) => setTime(c.id, d.id, "in", e.target.value)} onBlur={(e) => setTime(c.id, d.id, "in", fmtSchedTime(e.target.value))} />
                      </td>
                      <td>
                        <input className="time-in-text" value={en.out} placeholder="Out" onChange={(e) => setTime(c.id, d.id, "out", e.target.value)} onBlur={(e) => setTime(c.id, d.id, "out", fmtSchedTime(e.target.value))} />
                      </td>
                      <td className={"hrs " + (h ? "on " : "") + (h > 12 ? "dt" : h > 10 ? "ot" : "")}>{fmtHrs(h)}</td>
                    </React.Fragment>
                  );
                })}
                <td className="ptotal">{fmtHrs(personTotal(c.id))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky-col name-col foot">Daily total</td>
              {days.map((d) => (
                <td key={d.id} className="dtotal" colSpan={3}>
                  {fmtHrs(dayTotal(d.id))} hrs
                </td>
              ))}
              <td className="grand">{fmtHrs(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="ot-summary">
        <div className="panel-title-row"><h3 className="panel-title">Overtime breakdown</h3></div>
        <div className="ts-wrap">
          <table className="timesheet ot-table">
            <thead>
              <tr>
                <th className="sticky-col name-col">Crew</th>
                <th>Regular</th>
                <th>OT ×1.5<span className="ot-sub">10–12h/day</span></th>
                <th>DT ×2<span className="ot-sub">12h+/day</span></th>
                <th className="total-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {crew.map((c) => {
                const t = personTiers(c.id);
                return (
                  <tr key={c.id}>
                    <td className="sticky-col name-col"><div className="crew-name">{c.name || "—"}</div></td>
                    <td>{fmtHrs(t.reg)}</td>
                    <td className={t.ot ? "ot on" : ""}>{fmtHrs(t.ot)}</td>
                    <td className={t.dt ? "dt on" : ""}>{fmtHrs(t.dt)}</td>
                    <td className="ptotal">{fmtHrs(t.reg + t.ot + t.dt)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col name-col foot">Totals</td>
                <td className="dtotal">{fmtHrs(grandTiers.reg)}</td>
                <td className={"dtotal " + (grandTiers.ot ? "ot" : "")}>{fmtHrs(grandTiers.ot)}</td>
                <td className={"dtotal " + (grandTiers.dt ? "dt" : "")}>{fmtHrs(grandTiers.dt)}</td>
                <td className="grand">{fmtHrs(grandTiers.reg + grandTiers.ot + grandTiers.dt)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="ot-note">Tiers are calculated per day: hours 10–12 count as time-and-a-half, hours past 12 as double time.</p>
      </div>
      {!days.length && <Empty>No days yet. Add a day to start tracking.</Empty>}
    </div>
  );
}

/* ============================================================
   LABOR ROSTER TAB — global crew directory (admin only).
   Crew members here auto-populate the Brief's crew section.
   ============================================================ */
/* RosterForm must be a top-level component (not defined inside RosterTab)
   so React doesn't remount it on every keystroke and lose input focus. */
function RosterForm({ vals, onChange, onSave, onCancel, saveLabel = "Save", busy, positions }) {
  return (
    <div className="roster-form">
      <div className="roster-sect-lbl">Work info</div>
      <div className="roster-form-grid">
        <div className="roster-form-col">
          <label className="roster-lbl">Name</label>
          <input className="roster-inp" value={vals.name || ""} placeholder="Full name" onChange={(e) => onChange("name", e.target.value)} />
        </div>
        <div className="roster-form-col">
        <div className="roster-form-col full">
          <label className="roster-lbl">Positions — tap to select (multiple allowed)</label>
          <div className="roster-pos-sel">
            {(positions || []).map((p) => {
              const cur = Array.isArray(vals.positions) ? vals.positions : (vals.position ? [vals.position] : []);
              const on = cur.includes(p);
              return (
                <button key={p} type="button" className={"roster-pos-opt " + (on ? "on" : "")}
                  onClick={() => {
                    const next = on ? cur.filter((x) => x !== p) : [...cur, p];
                    onChange("positions", next);
                  }}>
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Phone</label>
          <input className="roster-inp" value={vals.phone || ""} placeholder="(555) 000-0000" onChange={(e) => onChange("phone", e.target.value)} />
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Email</label>
          <input className="roster-inp" value={vals.email || ""} placeholder="name@email.com" onChange={(e) => onChange("email", e.target.value)} />
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Rate type</label>
          <select className="roster-inp" value={vals.rateType || "day"} onChange={(e) => onChange("rateType", e.target.value)}>
            <option value="day">Day rate</option>
            <option value="hourly">Hourly</option>
          </select>
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Rate (${vals.rateType === "hourly" ? "hr" : "day"})</label>
          <input className="roster-inp" value={vals.rate || ""} placeholder="$" onChange={(e) => onChange("rate", e.target.value)} />
        </div>
        <div className="roster-form-col full">
          <label className="roster-lbl">Notes</label>
          <input className="roster-inp" value={vals.notes || ""} placeholder="Union status, certs, availability…" onChange={(e) => onChange("notes", e.target.value)} />
        </div>
      </div>

      <div className="roster-sect-lbl" style={{ marginTop: 14 }}>Personal &amp; travel</div>
      <div className="roster-form-grid">
        <div className="roster-form-col">
          <label className="roster-lbl">Birthday</label>
          <input className="roster-inp" type="date" value={vals.birthday || ""} onChange={(e) => onChange("birthday", e.target.value)} />
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Shirt size</label>
          <select className="roster-inp" value={vals.shirtSize || ""} onChange={(e) => onChange("shirtSize", e.target.value)}>
            <option value="">—</option>
            {["XS","S","M","L","XL","2XL","3XL"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Home airport</label>
          <input className="roster-inp" value={vals.homeAirport || ""} placeholder="LAX, SFO, PHX…" onChange={(e) => onChange("homeAirport", e.target.value)} />
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">TSA PreCheck / KTN</label>
          <input className="roster-inp" value={vals.tsaPrecheck || ""} placeholder="Known Traveler Number" onChange={(e) => onChange("tsaPrecheck", e.target.value)} />
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Passport expires</label>
          <input className="roster-inp" type="date" value={vals.passportExp || ""} onChange={(e) => onChange("passportExp", e.target.value)} />
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Dietary restrictions</label>
          <input className="roster-inp" value={vals.dietary || ""} placeholder="Vegetarian, nut allergy…" onChange={(e) => onChange("dietary", e.target.value)} />
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Emergency contact</label>
          <input className="roster-inp" value={vals.emergencyName || ""} placeholder="Name" onChange={(e) => onChange("emergencyName", e.target.value)} />
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">Emergency phone</label>
          <input className="roster-inp" value={vals.emergencyPhone || ""} placeholder="(555) 000-0000" onChange={(e) => onChange("emergencyPhone", e.target.value)} />
        </div>
        <div className="roster-form-col">
          <label className="roster-lbl">W9 on file</label>
          <select className="roster-inp" value={vals.w9 || "no"} onChange={(e) => onChange("w9", e.target.value)}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>
      </div>

      <div className="roster-form-actions">
        <button className="pl-btn" onClick={onSave} disabled={busy}>{busy ? "Saving…" : saveLabel}</button>
        <button className="pl-quotecancelbtn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function RosterTab() {
  const { roster, positions, reload, reloadPositions, loading } = React.useContext(RosterCtx);
  const [editing, setEditing] = useState({}); // id -> draft data
  const [adding, setAdding] = useState(null); // null | draft
  const [busy, setBusy] = useState(false);
  const [filterPos, setFilterPos] = useState("All");
  const [posOpen, setPosOpen] = useState(false);
  const [newPos, setNewPos] = useState("");
  const [posBusy, setPosBusy] = useState(false);
  const [linkState, setLinkState] = useState("idle"); // idle | loading | done
  const [onboardUrl, setOnboardUrl] = useState("");

  const startEdit = (m) =>
    setEditing((e) => ({ ...e, [m.id]: { name: m.name, ...(m.data || {}) } }));
  const patchEdit = (id, k, v) =>
    setEditing((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));
  const cancelEdit = (id) =>
    setEditing((e) => { const n = { ...e }; delete n[id]; return n; });

  const saveEdit = async (m) => {
    const d = editing[m.id];
    if (!d) return;
    setBusy(true);
    const { name, ...data } = d;
    try { await saveRosterMember(name || m.name, data, m.id); await reload(); cancelEdit(m.id); }
    catch (e) { window.alert("Save failed: " + e.message); }
    finally { setBusy(false); }
  };

  const deleteMember = async (m) => {
    if (!window.confirm(`Remove ${m.name} from the roster?`)) return;
    setBusy(true);
    try { await deleteRosterMember(m.id); await reload(); }
    catch (e) { window.alert("Delete failed: " + e.message); }
    finally { setBusy(false); }
  };

  const saveNew = async () => {
    if (!adding?.name?.trim()) { window.alert("Name is required."); return; }
    setBusy(true);
    const { name, ...data } = adding;
    try { await saveRosterMember(name.trim(), data); await reload(); setAdding(null); }
    catch (e) { window.alert("Save failed: " + e.message); }
    finally { setBusy(false); }
  };

  const genLink = async () => {
    setLinkState("loading");
    try {
      const r = await generateOnboardLink();
      setOnboardUrl(r.url);
      setLinkState("done");
    } catch (e) {
      window.alert("Couldn\'t generate link: " + (e.message || "error"));
      setLinkState("idle");
    }
  };
  const copyLink = () => { navigator.clipboard?.writeText(onboardUrl).catch(() => {}); };

  const addPosition = async () => {
    const p = newPos.trim();
    if (!p || positions.includes(p)) return;
    const next = [...positions, p];
    setPosBusy(true);
    try { await savePositions(next); await reloadPositions(); setNewPos(""); }
    catch (e) { window.alert("Couldn't save: " + e.message); }
    finally { setPosBusy(false); }
  };
  const removePosition = async (pos) => {
    if (!window.confirm(`Remove "${pos}" from the positions list?`)) return;
    const next = positions.filter((p) => p !== pos);
    setPosBusy(true);
    try { await savePositions(next); await reloadPositions(); if (filterPos === pos) setFilterPos("All"); }
    catch (e) { window.alert("Couldn't save: " + e.message); }
    finally { setPosBusy(false); }
  };


  return (
    <div className="stack">
      <div className="tab-lead">
        <p>Your global crew directory. Type any name in the Brief's crew section and it auto-completes from here — filling in their position, phone, email, and rate automatically.</p>
        {!adding && <AddBtn onClick={() => setAdding({ name: "", position: "", phone: "", email: "", rateType: "day", rate: "", notes: "" })}>Crew member</AddBtn>}
      </div>

      {/* onboarding link */}
      <div className="pl-import">
        <button className="pl-importtoggle" onClick={() => { if (linkState === "idle") genLink(); }}>
          {linkState === "loading" ? "▸ Generating link…" : linkState === "done" ? "▾ Crew onboarding link" : "▸ Share onboarding link with crew"}
        </button>
        {linkState === "done" && (
          <div className="pl-importbody">
            <p className="pl-tplnote" style={{ margin: "0 0 10px" }}>
              Send this link to your crew — they fill out their own info and it goes straight into the roster. Valid for 60 days. Regenerate to invalidate old links.
            </p>
            <div className="roster-linkbox">
              <input className="roster-linkurl" readOnly value={onboardUrl} onFocus={(e) => e.target.select()} />
              <button className="pl-btn" onClick={copyLink}>Copy</button>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button className="pl-quotecancelbtn" onClick={() => { setLinkState("idle"); setOnboardUrl(""); }}>Close</button>
              <button className="pl-quotecancelbtn" onClick={genLink}>↺ Regenerate</button>
            </div>
          </div>
        )}
      </div>

      {/* position management */}
      <div className="roster-posbar">
        <div className="roster-poschips">
          <button className={"pl-chip " + (filterPos === "All" ? "on" : "")} onClick={() => setFilterPos("All")}>All</button>
          {positions.filter((pos) => roster.some((m) => memberPositions(m.data).includes(pos))).map((pos) => (
            <button key={pos} className={"pl-chip " + (filterPos === pos ? "on" : "")} onClick={() => setFilterPos(filterPos === pos ? "All" : pos)}>{pos}</button>
          ))}
        </div>
        <button className="roster-managepos" onClick={() => setPosOpen((o) => !o)}>
          ⚙ {posOpen ? "Close" : "Manage positions"}
        </button>
      </div>

      {posOpen && (
        <div className="pl-import" style={{ marginBottom: 0 }}>
          <div className="pl-importbody">
            <div className="pl-tplhdr" style={{ margin: "0 0 8px" }}>Position list — used as dropdown options when adding crew</div>
            <div className="roster-pos-chips">
              {positions.map((pos) => (
                <span key={pos} className="roster-pos-chip">
                  {pos}
                  <button onClick={() => removePosition(pos)} title="Remove" disabled={posBusy}>×</button>
                </span>
              ))}
            </div>
            <div className="roster-pos-add">
              <input
                className="roster-inp"
                value={newPos}
                placeholder="New position…"
                onChange={(e) => setNewPos(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPosition()}
              />
              <button className="pl-btn" onClick={addPosition} disabled={posBusy || !newPos.trim()}>Add</button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <Panel title="New crew member">
          <RosterForm
            vals={adding}
            onChange={(k, v) => setAdding((a) => ({ ...a, [k]: v }))}
            onSave={saveNew}
            onCancel={() => setAdding(null)}
            saveLabel="Add to roster"
            busy={busy}
            positions={positions}
          />
        </Panel>
      )}

      <Panel title="Crew roster" sub={loading ? "Loading…" : `${roster.length} member${roster.length === 1 ? "" : "s"}`}>
        {roster.length === 0 && !loading && (
          <Empty>No crew yet. Add your first member above.</Empty>
        )}
        <div className="roster-list">
          {roster.filter((m) => filterPos === "All" || memberPositions(m.data).includes(filterPos)).map((m) => {
            const d = m.data || {};
            const isEdit = !!editing[m.id];
            return (
              <div key={m.id} className={"roster-row " + (isEdit ? "editing" : "")}>
                {isEdit ? (
                  <RosterForm
                    vals={editing[m.id]}
                    onChange={(k, v) => patchEdit(m.id, k, v)}
                    onSave={() => saveEdit(m)}
                    onCancel={() => cancelEdit(m.id)}
                    busy={busy}
                    positions={positions}
                  />
                ) : (
                  <>
                    <div className="roster-person">
                      <span className="roster-name">{m.name}</span>
                      <div className="roster-pos-tags">
                        {memberPositions(d).length > 0
                          ? memberPositions(d).map((p) => <span key={p} className="roster-pos-tag">{p}</span>)
                          : <span className="roster-pos" />}
                      </div>
                    </div>
                    <div className="roster-contact">
                      {d.phone && <a href={"tel:" + d.phone} className="roster-link">📞 {d.phone}</a>}
                      {d.email && <a href={"mailto:" + d.email} className="roster-link">✉ {d.email}</a>}
                    </div>
                    <div className="roster-rate">
                      {d.rate ? (d.rateType === "hourly" ? `$${d.rate}/hr` : `$${d.rate}/day`) : <span className="roster-none">No rate</span>}
                    </div>
                    {d.notes && <div className="roster-notes">{d.notes}</div>}
                    <div className="roster-actions">
                      <button className="daysort" onClick={() => startEdit(m)}>Edit</button>
                      <button className="pl-x" style={{ width: 28, height: 28 }} onClick={() => deleteMember(m)} title="Remove">×</button>
                    </div>
                    {(d.birthday || d.shirtSize || d.homeAirport || d.tsaPrecheck || d.passportExp || d.dietary || d.emergencyName || d.w9 === "yes") && (
                      <div className="roster-extras">
                        {d.birthday && <span className="roster-chip">🎂 {new Date(d.birthday + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                        {d.shirtSize && <span className="roster-chip">👕 {d.shirtSize}</span>}
                        {d.homeAirport && <span className="roster-chip">✈ {d.homeAirport.toUpperCase()}</span>}
                        {d.tsaPrecheck && <span className="roster-chip">🔒 TSA {d.tsaPrecheck}</span>}
                        {d.passportExp && <span className="roster-chip">🛂 exp {new Date(d.passportExp + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>}
                        {d.dietary && <span className="roster-chip">🍽 {d.dietary}</span>}
                        {d.emergencyName && <span className="roster-chip">🚨 {d.emergencyName}{d.emergencyPhone ? " · " + d.emergencyPhone : ""}</span>}
                        {d.w9 === "yes" && <span className="roster-chip">W9 ✓</span>}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   P&L / COSTING TAB — admin only. Budget vs actual for a show.
   Stored in a separate Airtable "Costing" field via /api/costing, so the
   figures are never sent to crew — only admin tokens can read or write them.
   ============================================================ */
function normalizeCosting(x) {
  x = x || {};
  const out = {
    billableEst: x.billableEst || "",
    billableAct: x.billableAct || "",
    perDiemRate: x.perDiemRate || "",
    crewCost: x.crewCost && typeof x.crewCost === "object" ? x.crewCost : {},
    vendorCost: x.vendorCost && typeof x.vendorCost === "object" ? x.vendorCost : {},
    laborExtra: Array.isArray(x.laborExtra) ? x.laborExtra : [],
    vendorExtra: Array.isArray(x.vendorExtra) ? x.vendorExtra : [],
    misc: Array.isArray(x.misc) ? x.misc : [],
  };
  // migrate any earlier free-form rows so nothing is lost
  if (Array.isArray(x.labor)) out.laborExtra = out.laborExtra.concat(x.labor);
  if (Array.isArray(x.vendors)) out.vendorExtra = out.vendorExtra.concat(x.vendors);
  return out;
}
const pnlNum = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const pnlMoney = (n) => (n < 0 ? "\u2212$" : "$") + Math.abs(Math.round(n)).toLocaleString();
const pnlPct = (r) => (r * 100).toFixed(1) + "%";

function CostingTab({ event }) {
  const [c, setC] = useState(null);
  const [state, setState] = useState("loading"); // loading | idle | error
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);
  const [pnlImp, setPnlImp] = useState({ open: false, phase: "idle", preview: null, error: "" });
  const pnlInputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    getCosting(event.id)
      .then((r) => {
        if (!alive) return;
        setC(normalizeCosting(r.costing));
        setState("idle");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [event.id]);

  const queueSave = (next) => {
    setC(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSaving(true);
      saveCosting(event.id, next)
        .then(() => setSaving(false))
        .catch(() => setSaving(false));
    }, 800);
  };
  const mutate = (fn) => {
    const next = JSON.parse(JSON.stringify(c));
    fn(next);
    queueSave(next);
  };

  /* ---- quote PDF import for P&L ---- */
  const setPnl = (patch) => setPnlImp((p) => ({ ...p, ...patch }));
  const resetPnlImp = () => setPnlImp({ open: false, phase: "idle", preview: null, error: "" });
  const handlePnlFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (pnlInputRef.current) pnlInputRef.current.value = "";
    if (file.type !== "application/pdf") { setPnl({ error: "Please select a PDF file." }); return; }
    if (file.size > 4 * 1024 * 1024) { setPnl({ error: "PDF too large — max 4 MB." }); return; }
    setPnl({ phase: "loading", error: "" });
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = (ev) => res(ev.target.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const result = await importQuote(base64);
      if (!result.costing) throw new Error("No financial data found in this quote.");
      setPnl({ phase: "preview", preview: result, error: "" });
    } catch (err) {
      setPnl({ phase: "error", error: err.message || "Failed to parse quote." });
    }
  };
  const applyPnlImport = () => {
    const pnl = pnlImp.preview?.costing;
    if (!pnl?.billableEst) return;
    mutate((n) => { n.billableEst = String(pnl.billableEst); });
    resetPnlImp();
  };

  if (state === "loading") return <Panel title="P&L / Costing"><Empty>Loading…</Empty></Panel>;
  if (state === "error")
    return (
      <Panel title="P&L / Costing">
        <Empty>Couldn’t load costing. The Airtable “Costing” field may not be set up yet — see the setup note.</Empty>
      </Panel>
    );

  const sum = (arr, k) => arr.reduce((s, r) => s + pnlNum(r[k]), 0);

  // ---- pull crew (with hours) from Brief + time tracker ----
  const crewRows = (event.crew || []).filter((cm) => cm.name && cm.name.trim());
  const tdays = event.time?.days || [];
  const tentry = (cid, did) => event.time?.entries?.[cid]?.[did] || { in: "", out: "" };
  const crewHours = (cid) =>
    tdays.reduce(
      (acc, d) => {
        const h = hoursBetween(tentry(cid, d.id).in, tentry(cid, d.id).out);
        const b = otBreakdown(h);
        acc.total += b.reg + b.ot + b.dt;
        acc.ot += b.ot;
        acc.dt += b.dt;
        if (h > 0) acc.days += 1;
        return acc;
      },
      { total: 0, ot: 0, dt: 0, days: 0 }
    );
  // actual labor cost from the person's rate + tracked time
  const crewActual = (cid) => {
    const cc = c.crewCost[cid] || {};
    const rate = pnlNum(cc.rate);
    if (!rate) return null;
    const h = crewHours(cid);
    if ((cc.rateType || "hourly") === "day") return rate * h.days;
    // hourly: regular + OT×1.5 + DT×2  ==  total + 0.5·OT + DT
    return rate * (h.total + 0.5 * h.ot + h.dt);
  };
  const setCrew = (cid, field, val) =>
    mutate((n) => {
      if (!n.crewCost[cid]) n.crewCost[cid] = { rateType: "hourly", rate: "", est: "", notes: "" };
      n.crewCost[cid][field] = val;
    });
  // per diem = days worked × the global rate; travel is a manual per-person figure
  const perDiemRate = pnlNum(c.perDiemRate);
  const crewPerDiem = (cid) => crewHours(cid).days * perDiemRate;
  const crewTravel = (cid) => pnlNum((c.crewCost[cid] || {}).travel);
  const crewTotalActual = (cid) => (crewActual(cid) || 0) + crewPerDiem(cid) + crewTravel(cid);

  // GSA per-diem lookup, seeded with the event location + fiscal year
  const gsaLoc = (event.venue?.address || event.venue?.name || "").trim();
  const gsaYear = (() => {
    const d = event.startDate ? new Date(event.startDate) : new Date();
    const y = d.getFullYear();
    return d.getMonth() + 1 >= 10 ? y + 1 : y; // GSA fiscal year: Oct–Sep
  })();
  const gsaUrl = "https://www.gsa.gov/travel/plan-book/per-diem-rates";

  // ---- pull vendors from the Pull List "Rented From" field (unique, with gear summary) ----
  const vendorMap = {};
  const collectVendor = (it) => {
    const raw = (it.rentedFrom || "").trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (!vendorMap[key]) vendorMap[key] = { name: raw, count: 0, items: [] };
    vendorMap[key].count += 1;
    const gear = (it.item || "").trim();
    if (gear && !vendorMap[key].items.includes(gear)) vendorMap[key].items.push(gear);
  };
  (event.pull?.cases || []).forEach((cs) => (cs.items || []).forEach(collectVendor));
  (event.pull?.loose || []).forEach(collectVendor);
  const vendorRows = Object.values(vendorMap).sort((a, b) => a.name.localeCompare(b.name));
  const gearSummary = (items) => (items.length <= 3 ? items.join(", ") : items.slice(0, 3).join(", ") + " +" + (items.length - 3));
  const setVend = (name, field, val) =>
    mutate((n) => {
      if (!n.vendorCost[name]) n.vendorCost[name] = { est: "", act: "", notes: "" };
      n.vendorCost[name][field] = val;
    });

  // ---- totals (roster + manual extras) ----
  const laborEst = crewRows.reduce((s, cm) => s + pnlNum(c.crewCost[cm.id]?.est), 0) + sum(c.laborExtra, "est");
  const laborAct = crewRows.reduce((s, cm) => s + crewTotalActual(cm.id), 0) + sum(c.laborExtra, "act");
  const vendEst = vendorRows.reduce((s, v) => s + pnlNum(c.vendorCost[v.name]?.est), 0) + sum(c.vendorExtra, "est");
  const vendAct = vendorRows.reduce((s, v) => s + pnlNum(c.vendorCost[v.name]?.act), 0) + sum(c.vendorExtra, "act");
  const miscEst = sum(c.misc, "est"), miscAct = sum(c.misc, "act");
  const billEst = pnlNum(c.billableEst), billAct = pnlNum(c.billableAct);
  const netEst = billEst - laborEst - vendEst - miscEst;
  const netAct = billAct - laborAct - vendAct - miscAct;
  const crewHrsLabel = (hrs) =>
    hrs.total ? fmtHrs(hrs.total) + "h" + (hrs.ot ? " · " + fmtHrs(hrs.ot) + " OT" : "") + (hrs.dt ? " · " + fmtHrs(hrs.dt) + " DT" : "") : "–";

  const row = (label, est, act, opts = {}) => (
    <tr className={opts.strong ? "pnl-strong" : ""}>
      <td className="pnl-sum-label">{label}</td>
      <td className={"pnl-sum-num " + (opts.neg && est ? "neg" : "")}>{opts.neg && est ? pnlMoney(-est) : pnlMoney(est)}</td>
      <td className={"pnl-sum-num " + (opts.neg && act ? "neg" : "")}>{opts.neg && act ? pnlMoney(-act) : pnlMoney(act)}</td>
    </tr>
  );

  return (
    <div className="stack">
      <div className="tab-lead">
        <p>
          Budget vs actual for this show. <b>Only admins can see this tab</b> — the figures live in a separate,
          admin-only store and are never sent to crew.
          <span className="pnl-save">{saving ? "Saving…" : "Saved"}</span>
        </p>
      </div>

      <div className="tab-lead">
        <p>
          Budget vs actual for this show. <b>Only admins can see this tab</b> — the figures live in a separate,
          admin-only store and are never sent to crew.
          <span className="pnl-save">{saving ? "Saving…" : "Saved"}</span>
        </p>
      </div>

      {/* import from quote PDF */}
      <div className="pl-import">
        <button className="pl-importtoggle" onClick={() => { setPnl({ open: !pnlImp.open }); if (pnlImp.open) resetPnlImp(); }}>
          {pnlImp.open ? "▾ " : "▸ "}Import from quote PDF
        </button>
        {pnlImp.open && (
          <div className="pl-importbody">
            {pnlImp.phase === "idle" && (
              <>
                <p className="pl-tplnote" style={{ margin: "4px 0 10px" }}>
                  Upload your quote PDF and it will automatically populate the billable total, labor sections, gear/vendor sections, and misc costs into this P&L.
                </p>
                <label className="pl-quotelabel">
                  <input ref={pnlInputRef} type="file" accept=".pdf,application/pdf" onChange={handlePnlFile} style={{ display: "none" }} />
                  <span className="pl-btn">📄 Choose PDF quote…</span>
                </label>
                {pnlImp.error && <div className="pl-quoteerr">{pnlImp.error}</div>}
              </>
            )}
            {pnlImp.phase === "loading" && (
              <div className="pl-quoteloading"><span className="pl-quotespinner" />Reading quote… this usually takes 5–15 seconds.</div>
            )}
            {pnlImp.phase === "error" && (
              <>
                <div className="pl-quoteerr">{pnlImp.error || "Failed to parse quote."}</div>
                <button className="pl-btn" style={{ marginTop: 8 }} onClick={() => setPnl({ phase: "idle", error: "" })}>Try again</button>
              </>
            )}
            {pnlImp.phase === "preview" && pnlImp.preview?.costing && (() => {
              const pnl = pnlImp.preview.costing;
              const hasPullData = (pnlImp.preview.cases || []).length > 0;
              return (
                <>
                  <div className="pl-tplhdr" style={{ marginBottom: 8 }}>Extracted from quote</div>
                  <div className="pnl-qpreview">
                    {pnl.billableEst ? (
                      <div className="pnl-qrow grand">
                        <span>Grand total (billable estimated)</span>
                        <span>{pnlMoney(pnl.billableEst)}</span>
                      </div>
                    ) : (
                      <div className="pnl-qrow"><span style={{ color: "#DC2626" }}>No grand total found in this quote.</span></div>
                    )}
                    {hasPullData && (
                      <div className="pnl-qrow"><span style={{ color: "#059669", fontSize: 12 }}>✓ Gear items also available — import them on the Pull List tab</span></div>
                    )}
                  </div>
                  <div className="pl-quoteactions" style={{ marginTop: 10 }}>
                    {pnl.billableEst && <button className="pl-btn" onClick={applyPnlImport}>Apply to P&L</button>}
                    <button className="pl-quotecancelbtn" onClick={resetPnlImp}>Cancel</button>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      <Panel title="Revenue" sub="What you're billing the client">
        <div className="pnl-billable">
          <Field label="Total billable — estimated">
            <input value={c.billableEst} placeholder="$" onChange={(e) => mutate((n) => (n.billableEst = e.target.value))} />
          </Field>
          <Field label="Total billable — actual">
            <input value={c.billableAct} placeholder="$" onChange={(e) => mutate((n) => (n.billableAct = e.target.value))} />
          </Field>
        </div>
      </Panel>

      <Panel title="Labor" sub="Crew from the Brief. Set a rate and the actual cost calculates from tracked hours." action={<AddBtn onClick={() => mutate((n) => n.laborExtra.push({ id: uid(), contractor: "", role: "", est: "", act: "", notes: "" }))}>Non-roster line</AddBtn>}>
        <div className="pnl-pdbar">
          <span className="pnl-pdlabel">Per diem rate</span>
          <input className="pnl-money" value={c.perDiemRate || ""} placeholder="$/day" onChange={(e) => mutate((n) => (n.perDiemRate = e.target.value))} />
          <span className="pnl-pdhint">per day worked</span>
          <a className="pnl-gsalink" href={gsaUrl} target="_blank" rel="noreferrer">
            Look up GSA rate{gsaLoc ? " for " + gsaLoc : ""} (FY{gsaYear}) ↗
          </a>
        </div>
        <div className="pnl-hscroll">
          <div className="rows">
            <div className="rowhead pnl-labor-grid"><span>Contractor</span><span>Time</span><span>Rate</span><span>Per diem</span><span>Travel</span><span>Est. $</span><span>Actual $</span><span>Notes</span><span /></div>
            {crewRows.map((cm) => {
              const cc = c.crewCost[cm.id] || {};
              const hrs = crewHours(cm.id);
              const rt = cc.rateType || "hourly";
              return (
                <div className="row pnl-labor-grid" key={cm.id}>
                  <span className="pnl-person"><b>{cm.name}</b><em>{cm.position || "—"}</em></span>
                  <span className="pnl-time" title={`Regular ${fmtHrs(hrs.total - hrs.ot - hrs.dt)} · OT ${fmtHrs(hrs.ot)} · DT ${fmtHrs(hrs.dt)}`}>
                    <b>{hrs.total ? fmtHrs(hrs.total) + "h" : "–"}</b>
                    <em>{hrs.days ? hrs.days + (hrs.days === 1 ? " day" : " days") : ""}</em>
                  </span>
                  <span className="pnl-rate">
                    <select value={rt} onChange={(e) => setCrew(cm.id, "rateType", e.target.value)}>
                      <option value="hourly">Hourly</option>
                      <option value="day">Day rate</option>
                    </select>
                    <input className="pnl-money" value={cc.rate || ""} placeholder={"$/" + (rt === "day" ? "day" : "hr")} onChange={(e) => setCrew(cm.id, "rate", e.target.value)} />
                  </span>
                  <span className="pnl-actual pd" title={`${hrs.days} day${hrs.days === 1 ? "" : "s"} × ${pnlMoney(perDiemRate)}`}>{perDiemRate && hrs.days ? pnlMoney(crewPerDiem(cm.id)) : "–"}</span>
                  <input className="pnl-money" value={cc.travel || ""} placeholder="$" onChange={(e) => setCrew(cm.id, "travel", e.target.value)} />
                  <input className="pnl-money" value={cc.est || ""} placeholder="$" onChange={(e) => setCrew(cm.id, "est", e.target.value)} />
                  <span className="pnl-actual" title="labor + per diem + travel">{pnlMoney(crewTotalActual(cm.id))}</span>
                  <input value={cc.notes || ""} placeholder="Notes" onChange={(e) => setCrew(cm.id, "notes", e.target.value)} />
                  <span className="pnl-tag" title="From the crew roster">roster</span>
                </div>
              );
            })}
            {c.laborExtra.map((r, i) => (
              <div className="row pnl-labor-grid" key={r.id}>
                <span className="pnl-person"><input value={r.contractor} placeholder="Name" onChange={(e) => mutate((n) => (n.laborExtra[i].contractor = e.target.value))} /><input value={r.role} placeholder="Role" onChange={(e) => mutate((n) => (n.laborExtra[i].role = e.target.value))} /></span>
                <span className="pnl-time dim">—</span>
                <span className="pnl-rate dim">manual →</span>
                <span className="pnl-actual pd dim">—</span>
                <input className="pnl-money" value={r.travel || ""} placeholder="$" onChange={(e) => mutate((n) => (n.laborExtra[i].travel = e.target.value))} />
                <input className="pnl-money" value={r.est} placeholder="$" onChange={(e) => mutate((n) => (n.laborExtra[i].est = e.target.value))} />
                <input className="pnl-money" value={r.act} placeholder="$" onChange={(e) => mutate((n) => (n.laborExtra[i].act = e.target.value))} />
                <input value={r.notes} placeholder="Notes" onChange={(e) => mutate((n) => (n.laborExtra[i].notes = e.target.value))} />
                <RemoveBtn onClick={() => mutate((n) => n.laborExtra.splice(i, 1))} />
              </div>
            ))}
            {!crewRows.length && !c.laborExtra.length && <Empty>Add crew on the Brief tab and they’ll appear here with their hours.</Empty>}
          </div>
        </div>
        <div className="pnl-subtotal">Labor subtotal (incl. per diem &amp; travel) — est {pnlMoney(laborEst)} · actual {pnlMoney(laborAct)}</div>
      </Panel>

      <Panel title="Gear & Vendors" sub="Vendors pulled from the “Rented From” field on the Pull List" action={<AddBtn onClick={() => mutate((n) => n.vendorExtra.push({ id: uid(), vendor: "", notes: "", est: "", act: "" }))}>Non-list line</AddBtn>}>
        <div className="rows">
          <div className="rowhead pnl-vendor-grid"><span>Vendor</span><span>Gear rented</span><span>Est. $</span><span>Actual $</span><span>Notes</span><span /></div>
          {vendorRows.map((v) => {
            const vc = c.vendorCost[v.name] || {};
            return (
              <div className="row pnl-vendor-grid" key={v.name}>
                <span className="pnl-derived">{v.name}</span>
                <span className="pnl-gear" title={v.items.join(", ")}>{gearSummary(v.items) || `${v.count} item${v.count === 1 ? "" : "s"}`}</span>
                <input className="pnl-money" value={vc.est || ""} placeholder="$" onChange={(e) => setVend(v.name, "est", e.target.value)} />
                <input className="pnl-money" value={vc.act || ""} placeholder="$" onChange={(e) => setVend(v.name, "act", e.target.value)} />
                <input value={vc.notes || ""} placeholder="Notes" onChange={(e) => setVend(v.name, "notes", e.target.value)} />
                <span className="pnl-tag" title="From the Pull List">pull</span>
              </div>
            );
          })}
          {c.vendorExtra.map((r, i) => (
            <div className="row pnl-vendor-grid" key={r.id}>
              <input value={r.vendor} placeholder="Vendor" onChange={(e) => mutate((n) => (n.vendorExtra[i].vendor = e.target.value))} />
              <span className="pnl-gear dim">—</span>
              <input className="pnl-money" value={r.est} placeholder="$" onChange={(e) => mutate((n) => (n.vendorExtra[i].est = e.target.value))} />
              <input className="pnl-money" value={r.act} placeholder="$" onChange={(e) => mutate((n) => (n.vendorExtra[i].act = e.target.value))} />
              <input value={r.notes} placeholder="Notes" onChange={(e) => mutate((n) => (n.vendorExtra[i].notes = e.target.value))} />
              <RemoveBtn onClick={() => mutate((n) => n.vendorExtra.splice(i, 1))} />
            </div>
          ))}
          {!vendorRows.length && !c.vendorExtra.length && <Empty>Set “Rented From” on Pull List items and those vendors will appear here.</Empty>}
        </div>
        <div className="pnl-subtotal">Gear subtotal — est {pnlMoney(vendEst)} · actual {pnlMoney(vendAct)}</div>
      </Panel>

      <Panel title="Misc" sub="Travel, per diem, expendables, etc." action={<AddBtn onClick={() => mutate((n) => n.misc.push({ id: uid(), name: "", est: "", act: "" }))}>Line</AddBtn>}>
        <div className="rows">
          <div className="rowhead pnl-misc-grid"><span>Description</span><span>Est. $</span><span>Actual $</span><span /></div>
          {c.misc.map((r, i) => (
            <div className="row pnl-misc-grid" key={r.id}>
              <input value={r.name} placeholder="Description" onChange={(e) => mutate((n) => (n.misc[i].name = e.target.value))} />
              <input className="pnl-money" value={r.est} placeholder="$" onChange={(e) => mutate((n) => (n.misc[i].est = e.target.value))} />
              <input className="pnl-money" value={r.act} placeholder="$" onChange={(e) => mutate((n) => (n.misc[i].act = e.target.value))} />
              <RemoveBtn onClick={() => mutate((n) => n.misc.splice(i, 1))} />
            </div>
          ))}
          {!c.misc.length && <Empty>No misc lines yet.</Empty>}
        </div>
        <div className="pnl-subtotal">Misc subtotal — est {pnlMoney(miscEst)} · actual {pnlMoney(miscAct)}</div>
      </Panel>

      <Panel title="Profit & Loss">
        <table className="pnl-summary">
          <thead><tr><th /><th>Estimated</th><th>Actual</th></tr></thead>
          <tbody>
            {row("Total billable", billEst, billAct)}
            {row("Labor", laborEst, laborAct, { neg: true })}
            {row("Gear & vendors", vendEst, vendAct, { neg: true })}
            {row("Misc", miscEst, miscAct, { neg: true })}
          </tbody>
          <tfoot>
            <tr className="pnl-net">
              <td className="pnl-sum-label">Net profit</td>
              <td className={"pnl-sum-num " + (netEst < 0 ? "neg" : "pos")}>{pnlMoney(netEst)}</td>
              <td className={"pnl-sum-num " + (netAct < 0 ? "neg" : "pos")}>{pnlMoney(netAct)}</td>
            </tr>
            <tr className="pnl-pct">
              <td className="pnl-sum-label">Profit margin</td>
              <td className="pnl-sum-num">{billEst ? pnlPct(netEst / billEst) : "—"}</td>
              <td className="pnl-sum-num">{billAct ? pnlPct(netAct / billAct) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </Panel>
    </div>
  );
}

/* ---------- misc ---------- */
function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
function prettyDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function briefText(e) {
  const L = [];
  L.push(`${e.name.toUpperCase()}`);
  if (e.client) L.push(`Client: ${e.client}`);
  L.push(`Dates: ${prettyDate(e.startDate)} – ${prettyDate(e.endDate)}`);
  L.push(`Venue: ${e.venue.name}${e.venue.address ? " — " + e.venue.address : ""}`);
  L.push("");
  if (e.contacts.some((c) => c.name)) {
    L.push("CONTACTS");
    e.contacts.filter((c) => c.name).forEach((c) => L.push(`• ${c.role}: ${c.name}  ${c.phone}  ${c.email}`));
    L.push("");
  }
  if (e.crew.length) {
    L.push("CREW");
    e.crew.forEach((c) => L.push(`• ${c.name} — ${c.position}  ${c.phone}`));
    L.push("");
  }
  if (e.schedule.length) {
    L.push("SCHEDULE");
    e.schedule.forEach((d) => {
      L.push(`${d.label}${d.date ? " (" + prettyDate(d.date) + ")" : ""}`);
      d.items.forEach((it) => L.push(`  ${it.time}  ${it.activity}`));
    });
    L.push("");
  }
  if (e.wardrobe) {
    L.push("WARDROBE");
    L.push(e.wardrobe);
  }
  return L.join("\n");
}

/* ============================================================
   Styles
   ============================================================ */
/* ============================================================
   PULL LIST TAB — gear pull & load-out, color-coded by category.
   Crew can check gear out/in anytime; editing the list is gated by a
   per-show lock (event.gearEditUnlocked) that only admin can flip.
   ============================================================ */
function groupPullByDrawer(items) {
  const out = [];
  let cur = null;
  for (const it of items) {
    const d = it.drawer || null;
    if (!cur || cur.drawer !== d) {
      cur = { drawer: d, items: [] };
      out.push(cur);
    }
    cur.items.push(it);
  }
  return out;
}

function PullTab({ event, update, isAdmin }) {
  const cases = event.pull.cases;
  const loose = event.pull.loose || [];
  const unlocked = !!event.gearEditUnlocked;
  const canEdit = isAdmin || unlocked;
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const [activeCat, setActiveCat] = useState("All");
  const [query, setQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [invState, setInvState] = useState("idle"); // idle | loading | error
  const [invCases, setInvCases] = useState([]);
  const [invPicked, setInvPicked] = useState(() => new Set());
  const [invSeeding, setInvSeeding] = useState(false);
  const invLoaded = useRef(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetState, setSheetState] = useState("idle"); // idle | previewing | preview | importing | done | error
  const [sheetPreview, setSheetPreview] = useState(null);
  const [sheetError, setSheetError] = useState("");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteState, setQuoteState] = useState("idle"); // idle | loading | preview | error
  const [quotePreview, setQuotePreview] = useState(null);
  const [quoteError, setQuoteError] = useState("");
  const quoteInputRef = useRef(null);
  const [savedTpls, setSavedTpls] = useState([]);
  const [tplState, setTplState] = useState("idle"); // idle | loading | error
  const tplLoaded = useRef(false);
  const [picked, setPicked] = useState(() => new Set());

  // if admin re-locks while a crew member is mid-edit, drop them out of edit mode
  useEffect(() => {
    if (!canEdit && editing) setEditing(false);
  }, [canEdit, editing]);

  const editOn = canEdit && editing;

  const toggleCase = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  /* ---- mutations (whole event autosaves via update) ---- */
  const patchCase = (id, patch) =>
    update((ev) => {
      const c = ev.pull.cases.find((x) => x.id === id);
      if (c) Object.assign(c, patch);
    });
  const deleteCase = (id) => {
    if (!window.confirm("Delete this whole case and its gear?")) return;
    update((ev) => {
      ev.pull.cases = ev.pull.cases.filter((x) => x.id !== id);
    });
  };
  const addCase = () => {
    const nextNo = Math.max(0, ...cases.map((c) => Number(c.caseNo) || 0)) + 1;
    const id = uid();
    update((ev) => ev.pull.cases.push({ id, caseNo: nextNo, case: "New Case", category: "Misc", drawers: [], items: [] }));
    setOpen((s) => new Set(s).add(id));
  };

  // items live either in a case's items array, or in pull.loose (cid === "loose")
  const listIn = (ev, cid) => (cid === "loose" ? ev.pull.loose : ev.pull.cases.find((x) => x.id === cid)?.items);
  const addItem = (cid, drawer = "") =>
    update((ev) => {
      const a = listIn(ev, cid);
      if (a) a.push({ ...pullItem(), drawer });
    });
  const addLoose = () =>
    update((ev) => {
      if (!Array.isArray(ev.pull.loose)) ev.pull.loose = [];
      ev.pull.loose.push(pullItem());
    });
  const patchItem = (cid, iid, patch) =>
    update((ev) => {
      const a = listIn(ev, cid);
      const it = a && a.find((x) => x.id === iid);
      if (it) Object.assign(it, patch);
    });
  const deleteItem = (cid, iid) =>
    update((ev) => {
      if (cid === "loose") ev.pull.loose = (ev.pull.loose || []).filter((x) => x.id !== iid);
      else {
        const c = ev.pull.cases.find((x) => x.id === cid);
        if (c) c.items = c.items.filter((x) => x.id !== iid);
      }
    });

  // drawers (named groups inside a case)
  const caseDrawerNames = (c) => {
    const explicit = Array.isArray(c.drawers) ? c.drawers : [];
    const fromItems = c.items.map((it) => (it.drawer || "").trim()).filter(Boolean);
    return [...new Set([...explicit, ...fromItems])];
  };
  const addDrawer = (cid) => {
    const name = window.prompt("Drawer name (e.g. XLR, Network, Inputs):", "");
    if (name === null || !name.trim()) return;
    update((ev) => {
      const c = ev.pull.cases.find((x) => x.id === cid);
      if (!c) return;
      if (!Array.isArray(c.drawers)) c.drawers = [];
      if (!c.drawers.includes(name.trim())) c.drawers.push(name.trim());
    });
  };
  const renameDrawer = (cid, oldName, newName) =>
    update((ev) => {
      const c = ev.pull.cases.find((x) => x.id === cid);
      if (!c) return;
      if (!Array.isArray(c.drawers)) c.drawers = [];
      const i = c.drawers.indexOf(oldName);
      if (i >= 0) c.drawers[i] = newName;
      else if (!c.drawers.includes(newName)) c.drawers.push(newName);
      c.items.forEach((it) => {
        if ((it.drawer || "") === oldName) it.drawer = newName;
      });
    });
  const deleteDrawer = (cid, name) =>
    update((ev) => {
      const c = ev.pull.cases.find((x) => x.id === cid);
      if (!c) return;
      if (Array.isArray(c.drawers)) c.drawers = c.drawers.filter((d) => d !== name);
      c.items.forEach((it) => {
        if ((it.drawer || "") === name) it.drawer = "";
      });
    });

  const findItemState = (cid, iid) => {
    const a = cid === "loose" ? loose : cases.find((x) => x.id === cid)?.items || [];
    return (a || []).find((x) => x.id === iid);
  };
  const toggleOut = (cid, iid) => {
    const it = findItemState(cid, iid);
    if (!it) return;
    patchItem(cid, iid, { out: !it.out, in: it.out ? false : it.in });
  };
  const toggleIn = (cid, iid) => {
    const it = findItemState(cid, iid);
    if (!it || !it.out) return;
    patchItem(cid, iid, { in: !it.in });
  };

  const setLock = (val) => update((ev) => (ev.gearEditUnlocked = val));

  /* ---- inventory ---- */
  const loadInv = async () => {
    setInvState("loading");
    try {
      const list = await listInventory();
      setInvCases(list);
      setInvState("idle");
      invLoaded.current = true;
    } catch {
      setInvState("error");
    }
  };
  const openInv = () => {
    const nx = !invOpen;
    setInvOpen(nx);
    if (nx && !invLoaded.current) loadInv();
  };
  const toggleInvPick = (id) =>
    setInvPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const addFromInv = () => {
    const chosen = invCases.filter((it) => invPicked.has(it.id));
    if (!chosen.length) return;
    update((ev) => {
      let nextNo = Math.max(0, ...ev.pull.cases.map((c) => Number(c.caseNo) || 0));
      chosen.forEach((inv) => {
        nextNo += 1;
        ev.pull.cases.push({
          id: uid(),
          caseNo: nextNo,
          case: inv.name,
          category: inv.category,
          drawers: Array.isArray(inv.data?.drawers) ? [...inv.data.drawers] : [],
          items: (inv.data?.items || []).map((it) => ({ ...it, id: uid(), out: false, in: false })),
        });
      });
    });
    setInvPicked(new Set());
    setInvOpen(false);
  };
  const saveCaseToInv = async (c) => {
    const existing = invCases.find((x) => x.name.toLowerCase() === c.case.toLowerCase());
    const msg = existing
      ? `Update "${existing.name}" in inventory with the current contents of this case?`
      : `Save "${c.case}" to your inventory?`;
    if (!window.confirm(msg)) return;
    const data = {
      drawers: Array.isArray(c.drawers) ? c.drawers : [],
      items: c.items.map(({ drawer, item, qty, source, rentedFrom, notes }) => ({ drawer, item, qty, source, rentedFrom, notes })),
    };
    try {
      await saveInventoryCase(c.case, c.category, data, existing?.id);
      invLoaded.current = false;
      if (invOpen) await loadInv();
      window.alert(`"${c.case}" ${existing ? "updated" : "saved"} in inventory.`);
    } catch (e) {
      window.alert("Couldn't save to inventory: " + (e.message || "error"));
    }
  };
  const deleteFromInv = async (id, name) => {
    if (!window.confirm(`Remove "${name}" from your inventory?`)) return;
    try {
      await deleteInventoryCase(id);
      setInvCases((s) => s.filter((x) => x.id !== id));
      setInvPicked((s) => { const n = new Set(s); n.delete(id); return n; });
    } catch (e) {
      window.alert("Couldn't remove: " + (e.message || "error"));
    }
  };
  const seedInventory = async () => {
    if (!window.confirm(`Seed your inventory from the built-in gear list?\nThis will add ${PULL_SEED.length} cases to Airtable. Run once to get started.`)) return;
    setInvSeeding(true);
    try {
      for (const c of PULL_SEED) {
        await saveInventoryCase(c.case, c.category, {
          drawers: Array.isArray(c.drawers) ? c.drawers : [],
          items: c.items.map(({ drawer, item, qty, source, rentedFrom, notes }) => ({ drawer, item, qty, source, rentedFrom, notes })),
        });
      }
      invLoaded.current = false;
      await loadInv();
    } catch (e) {
      window.alert("Seed error: " + (e.message || "error"));
    } finally {
      setInvSeeding(false);
    }
  };
  const previewSheet = async () => {
    if (!sheetUrl.trim()) return;
    setSheetState("previewing"); setSheetError("");
    try {
      const r = await previewInventoryImport(sheetUrl.trim());
      setSheetPreview(r); setSheetState("preview");
    } catch (e) { setSheetError(e.message || "Failed to read sheet."); setSheetState("error"); }
  };
  const importSheet = async () => {
    if (!window.confirm(`Replace all ${sheetPreview?.cases || ""}  sheet-imported inventory cases with the latest data from the sheet?\nManual cases you added in the app are untouched.`)) return;
    setSheetState("importing"); setSheetError("");
    try {
      await confirmInventoryImport(sheetUrl.trim());
      invLoaded.current = false;
      await loadInv();
      setSheetState("done");
      setTimeout(() => { setSheetState("idle"); setSheetPreview(null); }, 3000);
    } catch (e) { setSheetError(e.message || "Import failed."); setSheetState("error"); }
  };
  const resetQuote = () => {
    setQuoteState("idle");
    setQuotePreview(null);
    setQuoteError("");
  };
  const handleQuoteFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (quoteInputRef.current) quoteInputRef.current.value = "";
    if (file.type !== "application/pdf") { setQuoteError("Please select a PDF file."); return; }
    if (file.size > 4 * 1024 * 1024) { setQuoteError("PDF too large — max 4 MB. Try a smaller file."); return; }
    setQuoteState("loading");
    setQuoteError("");
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = (ev) => res(ev.target.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const result = await importQuote(base64);
      setQuotePreview(result);
      setQuoteState("preview");
    } catch (err) {
      setQuoteError(err.message || "Failed to parse quote.");
      setQuoteState("error");
    }
  };
  const applyQuotePreview = (replace) => {
    if (!quotePreview) return;
    const freshCases = pullFreshCases(quotePreview.cases || []);
    const freshLoose = pullFreshItems(quotePreview.loose || []);
    update((ev) => {
      if (replace) {
        ev.pull.cases = freshCases;
        ev.pull.loose = freshLoose;
      } else {
        const nextNo = Math.max(0, ...ev.pull.cases.map((c) => Number(c.caseNo) || 0));
        freshCases.forEach((c, i) => { c.caseNo = nextNo + i + 1; });
        ev.pull.cases.push(...freshCases);
        if (!Array.isArray(ev.pull.loose)) ev.pull.loose = [];
        ev.pull.loose.push(...freshLoose);
      }
    });
    setOpen(new Set());
    setQuoteOpen(false);
    resetQuote();
  };

  const clearAll = () => {
    if (!window.confirm("Clear the entire pull list for this show?\nThis removes every case, drawer and item and can't be undone.")) return;
    update((ev) => {
      ev.pull.cases = [];
      ev.pull.loose = [];
    });
    setOpen(new Set());
    setActiveCat("All");
  };

  const applyTemplate = (tpl) => {
    if ((cases.length > 0 || loose.length > 0) && !window.confirm('Replace the current pull list with the "' + tpl.name + '" template?\nThis clears what\'s here now and can\'t be undone.')) return;
    const d = tpl.build();
    update((ev) => {
      ev.pull.cases = d.cases;
      ev.pull.loose = d.loose || [];
    });
    setOpen(new Set());
    setActiveCat("All");
    setTemplatesOpen(false);
  };

  const loadTemplates = async () => {
    setTplState("loading");
    try {
      const list = await listTemplates();
      setSavedTpls(list);
      setTplState("idle");
      tplLoaded.current = true;
    } catch (e) {
      setTplState("error");
    }
  };
  const openTemplates = () => {
    const nx = !templatesOpen;
    setTemplatesOpen(nx);
    if (nx && !tplLoaded.current) loadTemplates();
  };
  const saveTemplate = async () => {
    if (!cases.length && !loose.length) {
      window.alert("Add some gear before saving it as a template.");
      return;
    }
    const name = window.prompt("Name this template (e.g. \u201cKeynote Rig\u201d, \u201c2-Room GS\u201d):", "");
    if (name === null || !name.trim()) return;
    try {
      await createTemplate(name.trim(), { cases, loose });
      await loadTemplates();
    } catch (e) {
      window.alert("Couldn't save template: " + (e.message || "error"));
    }
  };
  const removeTemplate = async (t) => {
    if (!window.confirm('Delete the template "' + t.name + '"? This removes it for everyone.')) return;
    try {
      await deleteTemplate(t.id);
      setSavedTpls((s) => s.filter((x) => x.id !== t.id));
    } catch (e) {
      window.alert("Couldn't delete template: " + (e.message || "error"));
    }
  };
  const applySaved = (t) => {
    if ((cases.length > 0 || loose.length > 0) && !window.confirm('Replace the current pull list with "' + t.name + '"?\nThis clears what\'s here now and can\'t be undone.')) return;
    const d = pullTplData(t.data);
    update((ev) => {
      ev.pull.cases = pullFreshCases(d.cases);
      ev.pull.loose = pullFreshItems(d.loose);
    });
    setOpen(new Set());
    setActiveCat("All");
    setTemplatesOpen(false);
  };
  const tplItemCount = (t) => {
    const d = pullTplData(t.data);
    return d.cases.reduce((n, c) => n + (c.items ? c.items.length : 0), 0) + d.loose.length;
  };

  /* ---- import from Audio / Video I/O ---- */
  const devices = [];
  (event.audio?.blocks || []).forEach((b) => devices.push({ key: "a-" + b.id, kind: "Audio", name: b.name || "Audio device", block: b }));
  (event.video?.blocks || []).forEach((b) => devices.push({ key: "v-" + b.id, kind: "Video", name: b.name || "Video device", block: b }));
  const togglePick = (k) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const runImport = () => {
    const chosen = devices.filter((d) => picked.has(d.key));
    if (!chosen.length) {
      setImportOpen(false);
      return;
    }
    update((ev) => {
      let nextNo = Math.max(0, ...ev.pull.cases.map((c) => Number(c.caseNo) || 0));
      chosen.forEach((d) => {
        nextNo += 1;
        const items = [];
        (d.block.ins || []).forEach((r) => {
          if (r.name) items.push({ ...pullItem(), drawer: "Inputs", item: r.name, notes: r.signal || "" });
        });
        (d.block.outs || []).forEach((r) => {
          if (r.name) items.push({ ...pullItem(), drawer: "Outputs", item: r.name, notes: r.signal || "" });
        });
        ev.pull.cases.push({ id: uid(), caseNo: nextNo, case: d.name, category: d.kind, items });
      });
    });
    setPicked(new Set());
    setImportOpen(false);
  };

  /* ---- derived ---- */
  const allItems = [...cases.flatMap((c) => c.items), ...loose];
  const totals = {
    items: allItems.length,
    out: allItems.filter((i) => i.out).length,
    back: allItems.filter((i) => i.in).length,
  };
  totals.outstanding = totals.out - totals.back;
  const perCat = {};
  PULL_CAT_ORDER.forEach((k) => (perCat[k] = 0));
  cases.forEach((c) => (perCat[c.category] = (perCat[c.category] || 0) + c.items.length));

  const q = query.trim().toLowerCase();
  const matchItem = (it, caseName) =>
    it.item.toLowerCase().includes(q) ||
    (it.drawer || "").toLowerCase().includes(q) ||
    (it.rentedFrom || "").toLowerCase().includes(q) ||
    (caseName || "").toLowerCase().includes(q);
  const visible = cases
    .filter((c) => activeCat === "All" || c.category === activeCat)
    .map((c) => ({ ...c, items: q && !editOn ? c.items.filter((it) => matchItem(it, c.case)) : c.items }))
    .filter((c) => editOn || c.items.length > 0 || activeCat !== "All");
  const looseVisible = q && !editOn ? loose.filter((it) => matchItem(it, "")) : loose;
  const showLoose = editOn || (activeCat === "All" && looseVisible.length > 0);

  const cat = (name) => PULL_CATS[name] || PULL_CATS.Misc;
  const prog = (c) => ({ out: c.items.filter((i) => i.out).length, back: c.items.filter((i) => i.in).length, total: c.items.length });

  /* ---- render helpers ---- */
  const SOURCE_OPTS = ["TCG", "Sub-Rental", "Venue", "Other"];
  const needsRentedFrom = (src) => src && src !== "TCG";
  const itemEdit = (cid, it) => (
    <div className="pl-item-edit" key={it.id}>
      <div className={"pl-ie1" + (needsRentedFrom(it.source) ? " with-rent" : "")}>
        <input className="pl-inp pl-iename" value={it.item} placeholder="Item name" onChange={(e) => patchItem(cid, it.id, { item: e.target.value })} />
        <input className="pl-inp pl-ieqty" value={it.qty} placeholder="Qty" onChange={(e) => patchItem(cid, it.id, { qty: e.target.value })} />
        <select className="pl-inp pl-iesrc" value={SOURCE_OPTS.includes(it.source) ? it.source : (it.source ? "Other" : "TCG")} onChange={(e) => patchItem(cid, it.id, { source: e.target.value, rentedFrom: e.target.value === "TCG" ? "" : it.rentedFrom })}>
          {SOURCE_OPTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        {needsRentedFrom(it.source) && (
          <input className="pl-inp pl-ierent" value={it.rentedFrom} placeholder="Vendor" onChange={(e) => patchItem(cid, it.id, { rentedFrom: e.target.value })} />
        )}
        <button className="pl-x" onClick={() => deleteItem(cid, it.id)} title="Remove item">×</button>
      </div>
      <input className="pl-inp pl-ienotes" value={it.notes} placeholder="Notes (optional)" onChange={(e) => patchItem(cid, it.id, { notes: e.target.value })} />
    </div>
  );
  const itemRead = (cid, it, cc) => {
    const outstanding = it.out && !it.in;
    return (
      <div className={"pl-row " + (outstanding ? "out" : "")} key={it.id}>
        <div className="pl-itemcol">
          <div className="pl-itemname">{it.item || "—"}</div>
          {(it.source || it.rentedFrom || it.notes) && (
            <div className="pl-meta">
              {it.source && it.source !== "TCG" && <span className="pl-badge">{it.source}</span>}
              {it.rentedFrom && <span className="pl-badge">{it.rentedFrom}</span>}
              {it.notes && <span className="pl-note">{it.notes}</span>}
            </div>
          )}
        </div>
        <div className="pl-qtyv">{it.qty !== "" ? "×" + it.qty : "—"}</div>
        <button className={"pl-check " + (it.out ? "on" : "")} style={it.out ? { background: cc.color, borderColor: cc.color, color: "#fff" } : {}} onClick={() => toggleOut(cid, it.id)}>{it.out ? "✓ " : ""}Out</button>
        <button className={"pl-check green " + (it.in ? "on" : "") + (!it.out ? " dis" : "")} onClick={() => toggleIn(cid, it.id)} disabled={!it.out} title={!it.out ? "Pull it out first" : "Check in"}>{it.in ? "✓ " : ""}In</button>
      </div>
    );
  };
  const caseBodyEdit = (c) => {
    const drawers = caseDrawerNames(c);
    const noDrawer = c.items.filter((it) => !(it.drawer || "").trim());
    return (
      <div className="pl-body">
        {noDrawer.map((it) => itemEdit(c.id, it))}
        <div className="pl-addrow">
          <button className="pl-additem" onClick={() => addItem(c.id)}>+ Add item</button>
          <button className="pl-adddrawer" onClick={() => addDrawer(c.id)}>+ Add drawer</button>
          {isAdmin && (
            <button className="pl-invsave" onClick={() => saveCaseToInv(c)} title="Save this case to your inventory">
              📦 Save to inventory
            </button>
          )}
        </div>
        {drawers.map((dn) => (
          <div className="pl-drawergrp" key={dn}>
            <div className="pl-drawerhead">
              <span className="pl-drawerchev">▾</span>
              <input className="pl-inp pl-drawername" value={dn} onChange={(e) => renameDrawer(c.id, dn, e.target.value)} />
              <button className="pl-x" onClick={() => deleteDrawer(c.id, dn)} title="Delete drawer (moves its items out)">×</button>
            </div>
            {c.items.filter((it) => (it.drawer || "").trim() === dn).map((it) => itemEdit(c.id, it))}
            <button className="pl-additem sub" onClick={() => addItem(c.id, dn)}>+ Add item to {dn}</button>
          </div>
        ))}
      </div>
    );
  };
  const caseBodyRead = (c, cc) => (
    <div className="pl-body">
      {groupPullByDrawer(c.items).map((g, gi) => (
        <div key={gi}>
          {g.drawer && <div className="pl-drawerlbl">{g.drawer}</div>}
          {g.items.map((it) => itemRead(c.id, it, cc))}
        </div>
      ))}
      {c.items.length === 0 && <div className="pl-emptycase">No items</div>}
    </div>
  );

  return (
    <div className="stack pull">
      {/* lock / mode bar */}
      <div className="pl-bar">
        <div className="pl-lockwrap">
          {isAdmin ? (
            <button className={"pl-lock " + (unlocked ? "open" : "")} onClick={() => setLock(!unlocked)}>
              {unlocked ? "🔓 Crew editing ON" : "🔒 Crew editing OFF"}
            </button>
          ) : unlocked ? (
            <span className="pl-locknote open">🔓 Editing unlocked by admin</span>
          ) : (
            <span className="pl-locknote">🔒 List locked — check-out only</span>
          )}
          {isAdmin && (
            <span className="pl-lockhint">
              {unlocked ? "Any crew on this show can edit the gear list." : "Only you (admin) can edit the gear list."}
            </span>
          )}
        </div>
        {canEdit && (
          <button className={"pl-editbtn " + (editing ? "on" : "")} onClick={() => setEditing((e) => !e)}>
            {editing ? "● Editing gear" : "Edit gear"}
          </button>
        )}
      </div>

      {/* tiles */}
      <div className="pl-tiles">
        <div className="pl-tile"><b>{totals.items}</b><span>Items</span></div>
        <div className="pl-tile"><b style={{ color: "#2563EB" }}>{totals.out}/{totals.items}</b><span>Pulled</span></div>
        <div className="pl-tile"><b style={{ color: "#059669" }}>{totals.back}/{totals.items}</b><span>Returned</span></div>
        <div className="pl-tile"><b style={{ color: totals.outstanding > 0 ? "#DC2626" : "#94A3B8" }}>{totals.outstanding}</b><span>Out on show</span></div>
      </div>

      {/* controls */}
      <div className="pl-controls">
        <div className="pl-chips">
          <button className={"pl-chip " + (activeCat === "All" ? "on" : "")} onClick={() => setActiveCat("All")}>All</button>
          {PULL_CAT_ORDER.map((k) => (
            <button key={k} className={"pl-chip " + (activeCat === k ? "on" : "")} onClick={() => setActiveCat(activeCat === k ? "All" : k)}>
              <span className="pl-dot" style={{ background: cat(k).color }} />
              {k}
              <span className="pl-chipn">{perCat[k] || 0}</span>
            </button>
          ))}
        </div>
        {!editOn && (
          <input className="pl-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search gear, case, or drawer…" />
        )}
      </div>

      {/* templates */}
      {editOn && (
        <div className="pl-import">
          <button className="pl-importtoggle" onClick={openTemplates}>
            {templatesOpen ? "▾ " : "▸ "}Templates
          </button>
          {templatesOpen && (
            <div className="pl-importbody">
              <div className="pl-tplhdr">Built-in</div>
              {PULL_TEMPLATES.map((t) => (
                <div key={t.key} className="pl-tpl">
                  <div className="pl-tplinfo">
                    <span className="pl-tplname">{t.name}</span>
                    <span className="pl-tpldesc">{t.desc}{t.count() > 0 ? " · " + t.count() + " items" : ""}</span>
                  </div>
                  <button className="pl-btn" onClick={() => applyTemplate(t)}>Apply</button>
                </div>
              ))}

              <div className="pl-tplhdr">Saved templates</div>
              {tplState === "loading" && <div className="pl-emptycase">Loading…</div>}
              {tplState === "error" && (
                <div className="pl-emptycase">Saved templates aren’t available yet — the “Templates” table may not be set up.</div>
              )}
              {tplState === "idle" && savedTpls.length === 0 && <div className="pl-emptycase">No saved templates yet.</div>}
              {savedTpls.map((t) => (
                <div key={t.id} className="pl-tpl">
                  <div className="pl-tplinfo">
                    <span className="pl-tplname">{t.name}</span>
                    <span className="pl-tpldesc">{tplItemCount(t)} items</span>
                  </div>
                  <button className="pl-btn" onClick={() => applySaved(t)}>Apply</button>
                  {isAdmin && <button className="pl-x" onClick={() => removeTemplate(t)} title="Delete template">×</button>}
                </div>
              ))}

              {isAdmin && (
                <button className="pl-savetpl" onClick={saveTemplate}>+ Save current list as template</button>
              )}
              <div className="pl-tplnote">Applying replaces this show’s list. Saved templates sync across devices.</div>
            </div>
          )}
        </div>
      )}

      {/* import from I/O */}
      {editOn && (
        <div className="pl-import">
          <button className="pl-importtoggle" onClick={() => setImportOpen((o) => !o)}>
            {importOpen ? "▾ " : "▸ "}Pull from Audio / Video I/O
          </button>
          {importOpen && (
            <div className="pl-importbody">
              {devices.length === 0 ? (
                <div className="pl-emptycase">No devices on the Audio or Video I/O tabs yet.</div>
              ) : (
                <>
                  {devices.map((d) => (
                    <label key={d.key} className="pl-improw">
                      <input type="checkbox" checked={picked.has(d.key)} onChange={() => togglePick(d.key)} />
                      <span className="pl-dot" style={{ background: cat(d.kind).color }} />
                      <span className="pl-impname">{d.name}</span>
                      <span className="pl-impmeta">{d.kind} · {(d.block.ins?.length || 0) + (d.block.outs?.length || 0)} lines</span>
                    </label>
                  ))}
                  <button className="pl-btn" onClick={runImport} disabled={picked.size === 0}>
                    Add {picked.size || ""} as case{picked.size === 1 ? "" : "s"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* inventory picker */}
      {editOn && (
        <div className="pl-import">
          <button className="pl-importtoggle" onClick={openInv}>
            {invOpen ? "▾ " : "▸ "}Browse inventory
          </button>
          {invOpen && (
            <div className="pl-importbody">
              {invState === "loading" && <div className="pl-emptycase">Loading inventory…</div>}
              {invState === "error" && (
                <div className="pl-emptycase">
                  Couldn't load inventory — is the "Inventory" table set up in Airtable?
                  <button className="pl-btn" style={{ marginTop: 8 }} onClick={loadInv}>Retry</button>
                </div>
              )}
              {invState === "idle" && invCases.length === 0 && (
                <div className="pl-emptycase">
                  <p style={{ margin: "0 0 10px" }}>Inventory is empty. Save cases from your pull list, or seed from the built-in gear list.</p>
                  {isAdmin && (
                    <button className="pl-btn" onClick={seedInventory} disabled={invSeeding}>
                      {invSeeding ? "Seeding…" : `Seed from built-in gear list (${PULL_SEED.length} cases)`}
                    </button>
                  )}
                </div>
              )}
              {invState === "idle" && invCases.length > 0 && (
                <>
                  {/* Google Sheet sync — admin only */}
                  {isAdmin && (
                    <div className="pl-sheetimport">
                      <div className="pl-tplhdr" style={{ margin: "0 0 6px" }}>Sync from Google Sheet</div>
                      <div className="pl-sheetrow">
                        <input
                          className="pl-search"
                          style={{ flex: 1, fontSize: 12 }}
                          value={sheetUrl}
                          onChange={(e) => { setSheetUrl(e.target.value); setSheetState("idle"); setSheetPreview(null); }}
                          placeholder="Paste Google Sheet URL…"
                        />
                        <button className="pl-btn" onClick={previewSheet} disabled={!sheetUrl.trim() || sheetState === "previewing"}>
                          {sheetState === "previewing" ? "Reading…" : "Preview"}
                        </button>
                      </div>
                      {sheetState === "error" && <div className="pl-quoteerr" style={{ marginTop: 6 }}>{sheetError}</div>}
                      {sheetState === "preview" && sheetPreview && (
                        <div className="pl-sheetpreview">
                          <div className="pl-sheetstat">
                            Found <b>{sheetPreview.cases}</b> cases · <b>{sheetPreview.items}</b> items
                            {sheetPreview.caseNames.some(c => c.name === "Unassigned Gear") && <span className="pl-sheetdim"> (incl. unassigned items)</span>}
                          </div>
                          <div className="pl-sheetchips">
                            {sheetPreview.caseNames.map((c) => {
                              const cc = PULL_CATS[c.category] || PULL_CATS.Misc;
                              return (
                                <span key={c.name} className="pl-sheetchip" style={{ borderColor: cc.ring }}>
                                  <span className="pl-dot" style={{ background: cc.color }} />
                                  {c.name}
                                  <span className="pl-sheetdim"> {c.count}</span>
                                </span>
                              );
                            })}
                          </div>
                          <div className="pl-sheetactions">
                            <button className="pl-btn" onClick={importSheet} disabled={sheetState === "importing"}>
                              {sheetState === "importing" ? "Importing…" : "Replace sheet cases"}
                            </button>
                            <button className="pl-quotecancelbtn" onClick={() => { setSheetState("idle"); setSheetPreview(null); }}>Cancel</button>
                          </div>
                          <p className="pl-tplnote" style={{ marginTop: 6 }}>Sheet-imported cases are replaced. Cases you added manually are kept.</p>
                        </div>
                      )}
                      {sheetState === "done" && <div style={{ color: "var(--green)", fontSize: 12.5, marginTop: 6, fontWeight: 600 }}>✓ Inventory synced from sheet</div>}
                    </div>
                  )}
                  <div className="pl-invcontrols">
                    <span className="pl-tplhdr" style={{ margin: 0 }}>{invCases.length} case{invCases.length === 1 ? "" : "s"} in inventory</span>
                    {isAdmin && (
                      <button className="pl-invseedbtn" onClick={seedInventory} disabled={invSeeding} title="Re-seed from built-in gear list">
                        {invSeeding ? "Seeding…" : "↺ Re-seed"}
                      </button>
                    )}
                  </div>
                  {PULL_CAT_ORDER.filter((k) => invCases.some((x) => x.category === k)).map((k) => {
                    const cc = PULL_CATS[k];
                    return (
                      <div key={k} className="pl-invcat-grp">
                        <div className="pl-invcat" style={{ color: cc.color }}>
                          <span className="pl-dot" style={{ background: cc.color }} />
                          {k}
                        </div>
                        {invCases.filter((x) => x.category === k).map((inv) => (
                          <label key={inv.id} className="pl-invrow">
                            <input type="checkbox" checked={invPicked.has(inv.id)} onChange={() => toggleInvPick(inv.id)} />
                            <span className="pl-invname">{inv.name}</span>
                            <span className="pl-invmeta">
                              {(inv.data?.items || []).length} items
                              {(inv.data?.drawers || []).length > 0 ? ` · ${inv.data.drawers.length} drawer${inv.data.drawers.length === 1 ? "" : "s"}` : ""}
                            </span>
                            {isAdmin && (
                              <button className="pl-x" style={{ width: 26, height: 26, fontSize: 14 }}
                                onClick={(e) => { e.preventDefault(); deleteFromInv(inv.id, inv.name); }}
                                title="Remove from inventory">×</button>
                            )}
                          </label>
                        ))}
                      </div>
                    );
                  })}
                  <button className="pl-btn" onClick={addFromInv} disabled={invPicked.size === 0} style={{ marginTop: 8 }}>
                    Add {invPicked.size || ""} case{invPicked.size === 1 ? "" : "s"} to this show
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* import from quote PDF */}
      {editOn && (
        <div className="pl-import">
          <button className="pl-importtoggle" onClick={() => { setQuoteOpen((o) => !o); resetQuote(); }}>
            {quoteOpen ? "▾ " : "▸ "}Import from quote PDF
          </button>
          {quoteOpen && (
            <div className="pl-importbody">
              {quoteState === "idle" && (
                <>
                  <p className="pl-tplnote" style={{ margin: "4px 0 10px" }}>
                    Upload a PDF quote (Current RMS or any format) and gear items will be automatically extracted and categorized. Labor and expense lines are skipped.
                  </p>
                  <label className="pl-quotelabel">
                    <input ref={quoteInputRef} type="file" accept=".pdf,application/pdf" onChange={handleQuoteFile} style={{ display: "none" }} />
                    <span className="pl-btn">📄 Choose PDF quote…</span>
                  </label>
                  {quoteError && <div className="pl-quoteerr">{quoteError}</div>}
                </>
              )}
              {quoteState === "loading" && (
                <div className="pl-quoteloading">
                  <span className="pl-quotespinner" />
                  Reading quote… this usually takes 5–15 seconds.
                </div>
              )}
              {quoteState === "error" && (
                <>
                  <div className="pl-quoteerr">{quoteError || "Failed to parse quote."}</div>
                  <button className="pl-btn" style={{ marginTop: 8 }} onClick={resetQuote}>Try again</button>
                </>
              )}
              {quoteState === "preview" && quotePreview && (() => {
                const totalItems = (quotePreview.cases || []).reduce((n, c) => n + (c.items || []).length, 0) + (quotePreview.loose || []).length;
                return (
                  <>
                    <div className="pl-tplhdr" style={{ marginBottom: 8 }}>
                      {quotePreview.cases.length} case{quotePreview.cases.length === 1 ? "" : "s"} · {totalItems} item{totalItems === 1 ? "" : "s"} extracted
                    </div>
                    <div className="pl-quotepreview">
                      {(quotePreview.cases || []).map((c, i) => {
                        const cc = PULL_CATS[c.category] || PULL_CATS.Misc;
                        return (
                          <div key={i} className="pl-quotecase">
                            <div className="pl-quotecasehead">
                              <span className="pl-quotedot" style={{ background: cc.color }} />
                              <span className="pl-quotecasename">{c.case}</span>
                              <span className="pl-quotecatetag" style={{ color: cc.color }}>{c.category}</span>
                              <span className="pl-quotecasecount">{(c.items || []).length} items</span>
                            </div>
                            <div className="pl-quoteitems">
                              {(c.items || []).slice(0, 4).map((it, j) => (
                                <span key={j} className="pl-quoteitem">
                                  {it.qty > 1 ? <b>{it.qty}×</b> : null}{it.qty > 1 ? " " : ""}{it.item}
                                </span>
                              ))}
                              {(c.items || []).length > 4 && (
                                <span className="pl-quoteitem more">+{c.items.length - 4} more</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="pl-quoteactions">
                      <button className="pl-btn" onClick={() => applyQuotePreview(false)}>
                        Add to existing list
                      </button>
                      <button className="pl-btn" style={{ background: "#DC2626" }} onClick={() => {
                        if ((cases.length > 0 || loose.length > 0) && !window.confirm("Replace the current pull list with the items from this quote?")) return;
                        applyQuotePreview(true);
                      }}>
                        Replace list
                      </button>
                      <button className="pl-quotecancelbtn" onClick={() => { setQuoteOpen(false); resetQuote(); }}>Cancel</button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* cases */}
      <div className="pl-cases">
        {editOn && (
          <div className="pl-toolbar">
            <button className="pl-tbbtn" onClick={addCase}>+ Add case</button>
            <button className="pl-tbbtn" onClick={addLoose}>+ Add loose gear</button>
          </div>
        )}

        {/* loose gear (not in a case) */}
        {showLoose && (
          <div className="pl-card pl-loosecard">
            <div className="pl-loosehead">
              <span className="pl-loosetitle">Loose gear</span>
              <span className="pl-loosesub">not in a case</span>
            </div>
            {editOn ? (
              <div className="pl-body">
                {loose.map((it) => itemEdit("loose", it))}
                <button className="pl-additem" onClick={addLoose}>+ Add loose gear</button>
              </div>
            ) : (
              <div className="pl-body">
                {looseVisible.map((it) => itemRead("loose", it, cat("Misc")))}
                {looseVisible.length === 0 && <div className="pl-emptycase">No loose gear</div>}
              </div>
            )}
          </div>
        )}

        {visible.map((c) => {
          const cc = cat(c.category);
          const p = prog(c);
          const isOpen = open.has(c.id) || (!!q && !editOn) || editOn;
          const done = p.total > 0 && p.back === p.total;
          return (
            <div className="pl-card" key={c.id} style={{ borderColor: cc.ring }}>
              {editOn ? (
                <div className="pl-headedit">
                  <span className="pl-bar2" style={{ background: cc.color }} />
                  <span className="pl-hash">#</span>
                  <input className="pl-inp pl-no" value={c.caseNo} onChange={(e) => patchCase(c.id, { caseNo: e.target.value })} />
                  <input className="pl-inp pl-name" value={c.case} placeholder="Case name" onChange={(e) => patchCase(c.id, { case: e.target.value })} />
                  <select className="pl-inp pl-cat" style={{ color: cc.color }} value={c.category} onChange={(e) => patchCase(c.id, { category: e.target.value })}>
                    {PULL_CAT_ORDER.map((k) => <option key={k}>{k}</option>)}
                  </select>
                  <button className="pl-del" onClick={() => deleteCase(c.id)} title="Delete case">Delete</button>
                </div>
              ) : (
                <button className="pl-head" style={{ background: cc.soft }} onClick={() => toggleCase(c.id)}>
                  <span className="pl-bar2" style={{ background: cc.color }} />
                  <span className="pl-caseno" style={{ background: cc.color }}>#{c.caseNo}</span>
                  <span className="pl-casename">{c.case}</span>
                  <span className="pl-tag" style={{ color: cc.color, borderColor: cc.ring }}>{c.category}</span>
                  <span className="pl-spacer" />
                  <span className="pl-count">
                    {p.out}/{p.total} pulled
                    {p.out > 0 && <em style={{ color: done ? "#059669" : "#64748B" }}> · {p.back}/{p.out} back</em>}
                  </span>
                  <span className="pl-chev" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>›</span>
                </button>
              )}
              {isOpen && (editOn ? caseBodyEdit(c) : caseBodyRead(c, cc))}
            </div>
          );
        })}

        {editOn && cases.length > 0 && <button className="pl-clear" onClick={clearAll}>Clear all gear</button>}
        {!editOn && visible.length === 0 && !showLoose && <div className="pl-empty">No gear matches that filter.</div>}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap');

.cb{
  --bg:#14161B; --panel:#1B1E26; --panel2:#232733; --line:#2E3441;
  --ink:#E9ECF2; --dim:#96A0B2; --faint:#6C7688;
  --amber:#FFB020; --amber-deep:#E8971A;
  --green:#5FD08A; --danger:#FF6B6B;
  background:var(--bg); color:var(--ink);
  font-family:'Inter',system-ui,sans-serif;
  min-height:100vh; padding:0 0 60px;
  -webkit-font-smoothing:antialiased;
}
.cb *{box-sizing:border-box;}
.cb .loading{padding:80px 24px; text-align:center; color:var(--dim); font-family:'Oswald'; letter-spacing:.08em;}

/* topbar */
.cb .topbar{
  display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  padding:12px 20px; background:#101218; border-bottom:1px solid var(--line);
  position:sticky; top:0; z-index:20;
}
.cb .brand{font-family:'Oswald'; font-weight:700; letter-spacing:.06em; font-size:19px; display:flex;}
.cb .brand-tab{background:var(--amber); color:#101218; padding:2px 8px; border-radius:3px 0 0 3px;}
.cb .brand-rest{background:var(--panel2); color:var(--ink); padding:2px 8px; border-radius:0 3px 3px 0;}
.cb .evt-picker{flex:1; min-width:180px;}
.cb .evt-picker select{
  width:100%; max-width:340px; background:var(--panel2); color:var(--ink);
  border:1px solid var(--line); border-radius:7px; padding:8px 10px;
  font-family:'Inter'; font-size:14px; font-weight:600;
}
.cb .top-actions{display:flex; gap:7px;}
.cb .btn{
  background:var(--panel2); color:var(--ink); border:1px solid var(--line);
  border-radius:7px; padding:8px 13px; font-size:13px; font-weight:600; cursor:pointer;
  font-family:'Inter'; transition:background .15s,border-color .15s;
}
.cb .btn:hover{background:#2B303C;}
.cb .btn.ghost{background:transparent;}
.cb .btn.amber{background:var(--amber); color:#101218; border-color:var(--amber);}
.cb .btn.amber:hover{background:var(--amber-deep);}
.cb .btn.danger{color:var(--danger); border-color:#4a2a2e;}
.cb .btn.danger:hover{background:#2a1a1d;}
.cb .savechip{
  font-size:11px; letter-spacing:.05em; color:var(--faint); font-weight:600;
  padding:4px 8px; border-radius:20px; white-space:nowrap;
}
.cb .savechip.saving{color:var(--amber);}
.cb .savechip.saved{color:var(--green);}

/* event header */
.cb .evt-head{
  display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap;
  padding:22px 24px 16px; border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,#171A21,#14161B);
}
.cb .evt-name-wrap{min-width:0;}
.cb .evt-name-input{
  font-family:'Oswald'; font-weight:600; font-size:30px; letter-spacing:.01em;
  background:transparent; border:none; color:var(--ink); width:100%; padding:0;
  border-bottom:2px solid transparent; line-height:1.1;
}
.cb .evt-name-input:focus{outline:none; border-bottom-color:var(--amber);}
.cb .evt-meta{display:flex; gap:9px; align-items:center; flex-wrap:wrap; margin-top:8px; color:var(--dim); font-size:13.5px; font-weight:500;}
.cb .evt-meta .dot{color:var(--faint);}
.cb .btn.copy{flex-shrink:0;}

/* tabs */
.cb .tabs{display:flex; gap:2px; padding:0 16px; border-bottom:1px solid var(--line); overflow-x:auto;}
.cb .tab{
  background:transparent; border:none; color:var(--dim); cursor:pointer;
  font-family:'Oswald'; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
  font-size:13px; padding:14px 16px 12px; border-bottom:2px solid transparent; white-space:nowrap;
}
.cb .tab:hover{color:var(--ink);}
.cb .tab.active{color:var(--amber); border-bottom-color:var(--amber);}

/* content */
.cb .content{max-width:1080px; margin:0 auto; padding:22px 20px;}
.cb .stack{display:flex; flex-direction:column; gap:18px;}
.cb .tab-lead{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; color:var(--dim); font-size:13.5px;}
.cb .tab-lead p{margin:0;}

/* home board */
.cb .home{max-width:1000px; margin:0 auto; padding:24px 20px 40px;}
.cb .hero{display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:24px;}
.cb .hero-main{min-width:0;}
.cb .board-label{font-family:'Oswald'; font-weight:600; letter-spacing:.14em; text-transform:uppercase; font-size:12px; color:var(--faint); margin:0 2px 12px;}
.cb .tilegrid{display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:14px;}
.cb .tile{
  position:relative; text-align:left; cursor:pointer; color:#1A130B;
  border:2px solid rgba(0,0,0,.5); border-radius:16px; padding:16px 16px 14px; min-height:150px;
  display:flex; flex-direction:column; gap:2px;
  box-shadow:0 6px 16px rgba(0,0,0,.32); font-family:'Inter';
  transition:transform .13s ease, box-shadow .13s ease;
}
.cb .tile:hover{transform:translateY(-4px); box-shadow:0 12px 26px rgba(0,0,0,.42);}
.cb .tile:active{transform:translateY(-1px);}
.cb .tile:focus-visible{outline:3px solid #fff; outline-offset:2px;}
.cb .tile-ico{color:#1A130B; opacity:.9; margin-bottom:8px; display:block;}
.cb .tile-label{font-family:'Oswald'; font-weight:600; letter-spacing:.02em; font-size:22px; line-height:1.05; color:#140E06;}
.cb .tile-desc{font-size:12.5px; font-weight:500; color:rgba(20,14,6,.72);}
.cb .tile-stat{
  margin-top:auto; align-self:flex-start; font-size:11.5px; font-weight:700;
  background:rgba(0,0,0,.16); color:rgba(20,14,6,.9);
  padding:3px 9px; border-radius:20px; letter-spacing:.01em;
}

/* section page bar */
.cb .pagebar{
  display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  max-width:1080px; margin:0 auto; padding:14px 20px 0;
}
.cb .backbtn{
  background:var(--panel2); color:var(--ink); border:1px solid var(--line);
  border-radius:8px; padding:8px 13px 8px 10px; font-size:13px; font-weight:600; cursor:pointer;
  font-family:'Inter'; display:inline-flex; align-items:center; gap:5px;
}
.cb .backbtn:hover{background:#2B303C; border-color:var(--amber);}
.cb .backbtn .chev{font-size:18px; line-height:1; margin-top:-1px;}
.cb .pagebar-title{font-family:'Oswald'; font-weight:600; letter-spacing:.05em; text-transform:uppercase; font-size:18px; color:var(--amber);}
.cb .pagebar-evt{margin-left:auto; color:var(--faint); font-size:13px; font-weight:500; max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}

/* panels */
.cb .panel{background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px 16px 18px;}
.cb .panel-h{display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:14px;}
.cb .panel-title{
  font-family:'Oswald'; font-weight:600; letter-spacing:.05em; text-transform:uppercase;
  font-size:15px; margin:0; color:var(--ink);
}
.cb .panel-sub{margin:3px 0 0; font-size:12px; color:var(--faint);}
.cb .grid2{display:grid; grid-template-columns:1fr 1fr; gap:12px 16px;}
.cb .grid2.top{align-items:start;}

/* fields */
.cb .field{display:flex; flex-direction:column; gap:5px;}
.cb .field span{font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--faint); font-weight:600;}
.cb input, .cb textarea, .cb select{
  background:var(--panel2); border:1px solid var(--line); border-radius:7px;
  color:var(--ink); font-family:'Inter'; font-size:13.5px; padding:8px 10px; width:100%;
}
.cb input:focus, .cb textarea:focus, .cb select:focus{outline:none; border-color:var(--amber); box-shadow:0 0 0 2px rgba(255,176,32,.15);}
.cb input::placeholder, .cb textarea::placeholder{color:var(--faint);}
.cb .area{resize:vertical; line-height:1.5;}
.cb input[type=date], .cb input[type=time]{color-scheme:dark;}

/* rows */
.cb .rows{display:flex; flex-direction:column; gap:6px;}
.cb .rowhead{display:grid; gap:8px; font-size:10.5px; letter-spacing:.05em; text-transform:uppercase; color:var(--faint); font-weight:600; padding:0 2px 2px;}
.cb .row{display:grid; gap:8px; align-items:center;}
.cb .contact-grid{grid-template-columns:1.1fr 1.1fr 1fr 1.4fr 28px;}
.cb .crew-grid{grid-template-columns:1.05fr 1.05fr 0.95fr 1.3fr 82px;}
.cb .row-tools{display:flex; align-items:center; gap:2px; justify-content:flex-end;}
.cb .panel-actions{display:flex; gap:6px; align-items:center;}
.cb .movebtn{background:transparent; border:1px solid transparent; color:var(--faint); width:24px; height:28px; border-radius:6px; cursor:pointer; font-size:11px; line-height:1;}
.cb .movebtn:hover:not(:disabled){color:var(--amber); background:var(--panel2);}
.cb .movebtn:disabled{opacity:.28; cursor:default;}
.cb .link-grid{grid-template-columns:1fr 1.6fr 28px;}
.cb .sched-grid{grid-template-columns:110px 1fr 28px;}
.cb .stay-grid{grid-template-columns:1.1fr 130px 130px .8fr 1.2fr 28px;}
.cb .flight-grid{grid-template-columns:1.1fr 130px 1fr .8fr 100px 100px .8fr 1fr 28px; min-width:900px;}
.cb .meal-grid{grid-template-columns:140px 100px 1.2fr 1.2fr 28px;}
.cb .note-grid{grid-template-columns:140px 1fr 28px;}
.cb .scroll-x{overflow-x:auto;}

.cb .remove{
  background:transparent; border:1px solid transparent; color:var(--faint);
  width:26px; height:30px; border-radius:6px; cursor:pointer; font-size:18px; line-height:1;
}
.cb .remove:hover{color:var(--danger); background:#2a1a1d;}
.cb .remove.sm{width:20px; height:20px; font-size:14px;}
.cb .add{
  align-self:flex-start; margin-top:10px; background:transparent; border:1px dashed var(--line);
  color:var(--amber); border-radius:7px; padding:7px 12px; font-size:12.5px; font-weight:600; cursor:pointer;
  font-family:'Inter';
}
.cb .add:hover{border-color:var(--amber); background:rgba(255,176,32,.06);}
.cb .empty{color:var(--faint); font-size:13px; padding:14px 4px; font-style:italic;}

/* schedule specifics */
.cb .daytitle{font-family:'Oswald'; font-weight:600; letter-spacing:.04em; text-transform:uppercase; font-size:15px; background:transparent; border:none; padding:0; border-bottom:1px solid transparent; max-width:340px;}
.cb .daytitle:focus{border-bottom-color:var(--amber); box-shadow:none;}
.cb .day-tools{display:flex; gap:8px; align-items:center;}
.cb .daysort{border:1px solid var(--line,#e2e8f0); background:#fff; color:#475569; border-radius:8px; padding:4px 10px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap;}
.cb .daysort:hover{background:#f1f5f9;}
.cb .daydate{width:130px;}
.cb .daytitle-ro{font-family:'Oswald'; font-weight:600; letter-spacing:.04em; text-transform:uppercase; font-size:15px;}
.cb .daydate-ro{font-size:12.5px; color:var(--muted,#64748b); font-weight:600;}
.cb .sched-ro{display:flex; flex-direction:column;}
.cb .sched-ro-row{display:flex; gap:12px; padding:7px 2px; border-bottom:1px solid var(--line,#eef2f7);}
.cb .sched-ro-row:last-child{border-bottom:none;}
.cb .sched-ro-time{flex:0 0 88px; font-weight:700; color:#0F1E35; font-variant-numeric:tabular-nums;}
.cb .sched-ro-act{flex:1; color:#1e293b;}
.cb .time-in-text{font-variant-numeric:tabular-nums;}

/* timesheet */
.cb .ts-wrap{overflow-x:auto; border:1px solid var(--line); border-radius:12px; background:var(--panel);}
.cb .timesheet{border-collapse:separate; border-spacing:0; width:100%; font-size:12.5px;}
.cb .timesheet th, .cb .timesheet td{padding:6px 6px; border-bottom:1px solid var(--line); text-align:center; white-space:nowrap;}
.cb .timesheet thead th{background:#101218; font-family:'Oswald'; font-weight:600; letter-spacing:.04em; color:var(--dim); font-size:11px;}
.cb .timesheet .subhead th{font-size:10px; text-transform:uppercase; color:var(--faint); padding:3px 6px;}
.cb .day-col{border-left:1px solid var(--line);}
.cb .day-head{display:flex; align-items:center; gap:4px; justify-content:center;}
.cb .daylabel{width:78px; text-align:center; background:transparent; border:none; color:var(--dim); font-family:'Oswald'; font-size:11px; padding:2px; letter-spacing:.03em;}
.cb .daylabel:focus{color:var(--amber); box-shadow:none;}
.cb .sticky-col{position:sticky; left:0; z-index:2; background:var(--panel); text-align:left;}
.cb .name-col{min-width:150px;}
.cb .timesheet thead .name-col{background:#101218;}
.cb .crew-name{font-weight:600; color:var(--ink);}
.cb .crew-pos{font-size:10.5px; color:var(--faint);}
.cb .timesheet td input{width:66px; padding:5px 4px; text-align:center; background:#191C24; font-variant-numeric:tabular-nums;}
.cb .hrs{font-variant-numeric:tabular-nums; color:var(--faint); font-weight:600; min-width:38px;}
.cb .hrs.on{color:var(--green);}
.cb .ptotal{font-variant-numeric:tabular-nums; font-weight:700; color:var(--amber); background:#191C24; border-left:1px solid var(--line);}
.cb .total-col{border-left:1px solid var(--line); min-width:52px;}
.cb .timesheet tfoot td{background:#101218; font-weight:600; border-bottom:none;}
.cb .foot{font-family:'Oswald'; letter-spacing:.04em; color:var(--dim);}
.cb .dtotal{font-variant-numeric:tabular-nums; color:var(--dim); border-left:1px solid var(--line);}
.cb .grand{font-variant-numeric:tabular-nums; color:var(--green); font-weight:700; font-size:14px; border-left:1px solid var(--line);}
.cb .hrs.ot{color:var(--amber);}
.cb .hrs.dt{color:var(--danger);}
.cb .ot-summary{margin-top:20px;}
.cb .ot-table td.ot{color:var(--amber); font-weight:600; font-variant-numeric:tabular-nums;}
.cb .ot-table td.dt{color:var(--danger); font-weight:600; font-variant-numeric:tabular-nums;}
.cb .ot-sub{display:block; font-size:9px; color:var(--faint); font-weight:400; letter-spacing:0; text-transform:none; margin-top:1px;}
.cb .ot-note{font-size:11.5px; color:var(--faint); margin-top:8px;}

/* weather */
.cb .wx-loc{display:flex; gap:8px; margin-bottom:10px;}
.cb .wx-now{display:flex; align-items:center; gap:10px; padding:2px 2px 12px; border-bottom:1px solid var(--line); margin-bottom:8px;}
.cb .wx-emoji{font-size:20px; line-height:1;}
.cb .wx-nowtemp{font-family:'Oswald'; font-size:22px; font-weight:600; color:var(--ink);}
.cb .wx-nowlbl{color:var(--dim); font-size:12.5px;}
.cb .wx-days{display:flex; flex-direction:column;}
.cb .wx-day{display:grid; grid-template-columns:24px minmax(84px,auto) 1fr auto 56px; gap:10px; align-items:center; padding:7px 2px; border-bottom:1px solid var(--line);}
.cb .wx-day:last-child{border-bottom:none;}
.cb .wx-date{font-weight:600; color:var(--ink); font-size:13px; white-space:nowrap;}
.cb .wx-cond{color:var(--dim); font-size:12.5px;}
.cb .wx-temp{font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap;}
.cb .wx-pop{color:#5AA9E6; font-size:11.5px; white-space:nowrap; text-align:right;}
.cb .wx-src{margin-top:8px; font-size:10.5px; color:var(--faint);}
@media (max-width:560px){
  .cb .wx-day{grid-template-columns:22px 1fr auto;}
  .cb .wx-cond, .cb .wx-pop{display:none;}
}

/* P&L / costing (admin only) */
.cb .pnl-save{margin-left:10px; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--faint);}
.cb .pnl-billable{display:grid; grid-template-columns:1fr 1fr; gap:14px; max-width:520px;}
.cb .pnl-hscroll{overflow-x:auto; -webkit-overflow-scrolling:touch;}
.cb .pnl-labor-grid{grid-template-columns:minmax(120px,1.1fr) 66px 120px 68px 66px 66px 78px minmax(110px,.9fr) 30px; min-width:780px;}
.cb .pnl-vendor-grid{grid-template-columns:1fr 1.5fr 84px 84px .9fr 30px;}
.cb .pnl-misc-grid{grid-template-columns:2fr 92px 92px 28px;}
.cb .pnl-pdbar{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid var(--line);}
.cb .pnl-pdlabel{font-family:'Oswald'; font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--dim);}
.cb .pnl-pdbar .pnl-money{width:80px;}
.cb .pnl-pdhint{font-size:11.5px; color:var(--faint);}
.cb .pnl-gsalink{margin-left:auto; font-size:12px; color:var(--amber); text-decoration:none; font-weight:600;}
.cb .pnl-gsalink:hover{text-decoration:underline;}
.cb .pnl-actual.pd{color:var(--dim); font-weight:600;}
.cb .pnl-actual.pd.dim{color:var(--faint);}
.cb .pnl-derived{display:flex; align-items:center; font-weight:600; color:var(--ink); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.cb .pnl-derived.dim{font-weight:400; color:var(--dim);}
.cb .pnl-person{display:flex; flex-direction:column; justify-content:center; min-width:0; gap:2px;}
.cb .pnl-person b{font-weight:600; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.cb .pnl-person em{font-style:normal; font-size:11px; color:var(--dim);}
.cb .pnl-person input{width:100%;}
.cb .pnl-time{display:flex; flex-direction:column; justify-content:center; font-variant-numeric:tabular-nums;}
.cb .pnl-time b{font-weight:600; color:var(--amber); font-size:12.5px;}
.cb .pnl-time em{font-style:normal; font-size:10.5px; color:var(--faint);}
.cb .pnl-time.dim{color:var(--faint);}
.cb .pnl-rate{display:flex; gap:4px; align-items:center;}
.cb .pnl-rate select{width:70px; padding:5px 4px; font-size:11.5px;}
.cb .pnl-rate .pnl-money{width:52px;}
.cb .pnl-rate.dim{color:var(--faint); font-size:11px; justify-content:center;}
.cb .pnl-actual{display:flex; align-items:center; justify-content:flex-end; font-variant-numeric:tabular-nums; font-weight:700; color:var(--green);}
.cb .pnl-gear{display:flex; align-items:center; font-size:11.5px; color:var(--dim); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.cb .pnl-gear.dim{color:var(--faint);}
.cb .pnl-hours{display:flex; align-items:center; font-size:11.5px; color:var(--amber); font-variant-numeric:tabular-nums;}
.cb .pnl-hours.dim{color:var(--faint);}
.cb .pnl-tag{display:flex; align-items:center; justify-content:center; font-size:9px; text-transform:uppercase; letter-spacing:.05em; color:var(--faint);}
.cb .pnl-money{font-variant-numeric:tabular-nums; text-align:right;}
.cb .pnl-subtotal{margin-top:10px; padding-top:8px; border-top:1px solid var(--line); font-size:12px; color:var(--dim); text-align:right; font-variant-numeric:tabular-nums;}
.cb .pnl-summary{border-collapse:separate; border-spacing:0; width:100%; max-width:520px; font-size:13px;}
.cb .pnl-summary th{font-family:'Oswald'; font-weight:600; letter-spacing:.04em; color:var(--dim); font-size:11px; text-transform:uppercase; text-align:right; padding:4px 10px;}
.cb .pnl-summary th:first-child{text-align:left;}
.cb .pnl-sum-label{text-align:left; color:var(--ink); padding:6px 10px;}
.cb .pnl-sum-num{text-align:right; font-variant-numeric:tabular-nums; color:var(--dim); padding:6px 10px; min-width:96px;}
.cb .pnl-summary td{border-bottom:1px solid var(--line);}
.cb .pnl-sum-num.neg{color:var(--danger);}
.cb .pnl-net .pnl-sum-label{font-family:'Oswald'; letter-spacing:.03em; color:var(--ink); font-size:14px;}
.cb .pnl-net .pnl-sum-num{font-weight:700; font-size:15px;}
.cb .pnl-net .pnl-sum-num.pos{color:var(--green);}
.cb .pnl-net .pnl-sum-num.neg{color:var(--danger);}
.cb .pnl-pct .pnl-sum-num{color:var(--amber); font-weight:600;}
.cb .pnl-pct td{border-bottom:none;}
@media (max-width:760px){
  .cb .pnl-billable{grid-template-columns:1fr;}
  .cb .rowhead.pnl-vendor-grid, .cb .rowhead.pnl-misc-grid{display:none;}
  .cb .pnl-vendor-grid{grid-template-columns:1fr 1fr;}
  .cb .pnl-misc-grid{grid-template-columns:1fr 1fr;}
}

/* audio / video I/O */
.cb .io-cols{display:grid; grid-template-columns:1fr 1fr; gap:16px;}
.cb .io-side{display:flex; flex-direction:column;}
.cb .io-side-h{font-family:'Oswald'; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--amber); margin-bottom:8px; padding-bottom:5px; border-bottom:1px solid var(--line);}
.cb .io-grid{grid-template-columns:44px 1.2fr .8fr .8fr 1fr 28px; min-width:420px;}
.cb .io-num{text-align:center; font-variant-numeric:tabular-nums; color:var(--dim);}

/* diagrams */
.cb .dropzone{border:1.5px dashed var(--line); border-radius:12px; background:var(--panel); transition:border-color .15s,background .15s;}
.cb .dropzone:hover{border-color:var(--amber);}
.cb .dz-inner{padding:26px 20px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:6px;}
.cb .dz-title{font-family:'Oswald'; font-weight:600; letter-spacing:.04em; text-transform:uppercase; font-size:16px; color:var(--ink);}
.cb .dz-sub{font-size:12.5px; color:var(--faint); margin-bottom:6px;}
.cb .dz-actions{display:flex; gap:8px; flex-wrap:wrap; justify-content:center; margin-top:6px;}
.cb .btn:disabled{opacity:.6; cursor:default;}
.cb .diagram-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:14px;}
.cb .diagram-card{position:relative; background:var(--panel); border:1px solid var(--line); border-radius:11px; overflow:hidden; display:flex; flex-direction:column;}
.cb .diagram-preview{aspect-ratio:16/10; background:#101218; display:flex; align-items:center; justify-content:center; overflow:hidden;}
.cb .diagram-preview img{width:100%; height:100%; object-fit:contain; display:block; cursor:zoom-in;}
.cb .diagram-ph{color:var(--faint); font-size:12.5px; display:flex; flex-direction:column; align-items:center; gap:8px;}
.cb .diagram-ph.link a{color:var(--amber); font-weight:600; text-decoration:none;}
.cb .link-badge{font-family:'Oswald'; font-size:11px; letter-spacing:.1em; color:#101218; background:var(--dim); padding:2px 8px; border-radius:3px;}
.cb .diagram-ph .dim{color:var(--faint);}
.cb .diagram-body{padding:10px; display:flex; flex-direction:column; gap:6px;}
.cb .diagram-name{font-weight:600; font-size:13px;}
.cb .diagram-url{font-size:12px; color:var(--amber);}
.cb .diagram-cap{font-size:12px; color:var(--dim);}
.cb .diagram-x{
  position:absolute; top:7px; right:7px; width:26px; height:26px; border-radius:6px;
  background:rgba(16,18,24,.82); border:1px solid var(--line); color:var(--ink);
  font-size:17px; line-height:1; cursor:pointer;
}
.cb .diagram-x:hover{color:var(--danger); border-color:var(--danger);}

/* records */
.cb .record-grid{grid-template-columns:130px 1fr 130px 2fr 28px;}

/* toast */
.cb .toast{
  position:fixed; bottom:22px; left:50%; transform:translateX(-50%);
  background:var(--amber); color:#101218; font-weight:600; font-size:13.5px;
  padding:11px 18px; border-radius:9px; box-shadow:0 8px 26px rgba(0,0,0,.4); z-index:50;
}

@media (max-width:760px){
  .cb .tilegrid{grid-template-columns:1fr 1fr; gap:11px;}
  .cb .tile{min-height:128px; padding:13px 12px 12px; border-radius:14px;}
  .cb .tile-label{font-size:19px;}
  .cb .tile-desc{font-size:11.5px;}
  .cb .hero{align-items:stretch;}
  .cb .pagebar-evt{display:none;}
  .cb .io-cols{grid-template-columns:1fr;}
  .cb .record-grid{grid-template-columns:1fr 1fr;}
  .cb .rowhead.record-grid{display:none;}
  .cb .grid2{grid-template-columns:1fr;}
  .cb .contact-grid, .cb .crew-grid{grid-template-columns:1fr 1fr; grid-auto-flow:row;}
  .cb .contact-grid .remove{grid-column:2; justify-self:end;}
  .cb .crew-grid .row-tools{grid-column:1 / -1; justify-content:flex-end;}
  .cb .rowhead.contact-grid, .cb .rowhead.crew-grid{display:none;}
  .cb .stay-grid{grid-template-columns:1fr 1fr; }
  .cb .rowhead.stay-grid{display:none;}
  .cb .meal-grid{grid-template-columns:1fr 1fr;}
  .cb .rowhead.meal-grid{display:none;}
  .cb .doclink-grid{grid-template-columns:1fr 1fr;}
  .cb .rowhead.doclink-grid{display:none;}
  .cb .doclink-grid .diagram-open{grid-column:1 / -1;}
  .cb .evt-name-input{font-size:24px;}
}
@media (prefers-reduced-motion:reduce){ .cb *{transition:none !important;} }

/* login (cloud build) */
.cb .login-wrap{min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:24px;}
.cb .login-card{background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:26px 24px; width:100%; max-width:360px; box-shadow:0 18px 50px rgba(0,0,0,.45);}
.cb .login-brand{justify-content:flex-start; font-size:22px; margin-bottom:18px;}
.cb .login-tabs{display:flex; gap:6px; margin-bottom:14px;}
.cb .login-tab{flex:1; background:var(--panel2); border:1px solid var(--line); color:var(--dim); border-radius:8px; padding:9px; font-weight:600; font-size:13px; cursor:pointer; font-family:'Inter';}
.cb .login-tab.on{background:var(--amber); color:#101218; border-color:var(--amber);}
.cb .login-hint{color:var(--faint); font-size:12.5px; margin:0 0 14px;}
.cb .login-input{margin-bottom:12px;}
.cb .login-err{color:var(--danger); font-size:12.5px; margin-bottom:12px;}
.cb .login-go{width:100%; justify-content:center; text-align:center;}
.cb .login-foot{color:var(--faint); font-size:11px; letter-spacing:.1em; text-transform:uppercase;}

/* top-right + locked picker (cloud build) */
.cb .top-right{display:flex; align-items:center; gap:10px; margin-left:auto;}
.cb .evt-picker.locked{flex:1;}
.cb .lock-name{font-family:'Oswald'; font-weight:600; letter-spacing:.02em; font-size:16px; color:var(--ink);}
.cb .signout{white-space:nowrap;}

/* diagram links (cloud build) */
.cb .diagramlink-grid{grid-template-columns:1.1fr 1.6fr 1.1fr 100px;}
.cb .diagram-open{display:flex; align-items:center; gap:6px; justify-content:flex-end;}
.cb .diagram-open a{color:var(--amber); font-weight:600; text-decoration:none; font-size:13px;}

/* show documents (cloud build) */
.cb .doclink-grid{grid-template-columns:1.2fr 116px 1.5fr 0.9fr 156px;}

/* inline link previews (cloud build) */
.cb .linkrow{display:flex; flex-direction:column; gap:4px;}
.cb .previewbtn{align-self:flex-start; border:1px solid var(--line); background:#fff; color:#475569; border-radius:8px; padding:4px 10px; font-size:12px; font-weight:600; cursor:pointer;}
.cb .previewbtn:hover{background:#f1f5f9;}
.cb .linkprev-frame{margin:2px 0 4px; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#fff;}
.cb .linkprev-frame iframe{width:100%; height:min(70vh,560px); border:none; display:block;}
.cb .linkprev-frame img{width:100%; height:auto; display:block; background:#f8fafc;}
.cb .linkprev-note{font-size:11px; color:var(--faint); padding:6px 10px; background:#f8fafc; border-top:1px solid var(--line);}

/* ---------- Pull List tab ---------- */
.pull { gap: 12px; }
.pl-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.pl-lockwrap { display:flex; align-items:center; gap:10px; flex-wrap:wrap; min-width:0; }
.pl-lock { border:1px solid #d8dee7; background:#fff; border-radius:999px; padding:7px 14px; font-size:13px; font-weight:700; cursor:pointer; color:#334155; }
.pl-lock.open { background:#ECFDF5; border-color:#A7E3C8; color:#047857; }
.pl-locknote { font-size:12.5px; font-weight:700; color:#64748b; }
.pl-locknote.open { color:#047857; }
.pl-lockhint { font-size:12px; color:#94a3b8; }
.pl-editbtn { border:none; border-radius:999px; padding:7px 16px; font-size:13px; font-weight:700; cursor:pointer; background:#e6edf6; color:#334155; }
.pl-editbtn.on { background:#38BDF8; color:#0F1E35; }

.pl-tiles { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.pl-tile { background:#0F1E35; border-radius:12px; padding:10px; text-align:center; }
.pl-tile b { display:block; font-size:19px; color:#fff; }
.pl-tile span { display:block; font-size:10.5px; letter-spacing:.5px; text-transform:uppercase; color:#9FB3CE; margin-top:2px; }

.pl-controls { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; }
.pl-chips { display:flex; flex-wrap:wrap; gap:6px; }
.pl-chip { border:1px solid #E2E8F0; background:#fff; border-radius:999px; padding:5px 12px; font-size:12.5px; font-weight:600; color:#334155; cursor:pointer; display:inline-flex; align-items:center; }
.pl-chip.on { background:#0F1E35; color:#fff; border-color:#0F1E35; }
.pl-dot { width:8px; height:8px; border-radius:999px; display:inline-block; margin-right:6px; }
.pl-chipn { opacity:.55; margin-left:6px; }
.pl-search { flex:1 1 200px; min-width:180px; border:1px solid #E2E8F0; border-radius:10px; padding:8px 12px; font-size:13px; outline:none; background:#fff; }

.pl-import { border:1px dashed #C3CDDA; border-radius:12px; background:#F8FAFC; padding:8px 12px; }
.pl-importtoggle { border:none; background:none; font-size:13px; font-weight:700; color:#334155; cursor:pointer; padding:2px 0; }
.pl-importbody { margin-top:8px; display:flex; flex-direction:column; gap:6px; }
.pl-improw { display:flex; align-items:center; gap:8px; font-size:13px; color:#1e293b; padding:4px 0; cursor:pointer; }
.pl-improw input { width:16px; height:16px; }
.pl-impname { font-weight:600; }
.pl-impmeta { color:#94a3b8; font-size:12px; margin-left:auto; }
.pl-btn { align-self:flex-start; margin-top:4px; border:none; background:#0F1E35; color:#fff; border-radius:8px; padding:7px 14px; font-size:12.5px; font-weight:700; cursor:pointer; }
.pl-btn:disabled { opacity:.45; cursor:not-allowed; }
.pl-tpl { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid #edf1f6; }
.pl-tpl:last-of-type { border-bottom:none; }
.pl-tplinfo { display:flex; flex-direction:column; min-width:0; flex:1; }
.pl-tplname { font-size:13px; font-weight:700; color:#1e293b; }
.pl-tpldesc { font-size:11.5px; color:#94a3b8; }
.pl-tpl .pl-btn { margin-top:0; }
.pl-tplnote { font-size:11.5px; color:#94a3b8; margin-top:6px; }
.pl-tplhdr { font-size:10.5px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; color:#94a3b8; margin:6px 0 2px; }
.pl-tplhdr:first-child { margin-top:0; }
.pl-savetpl { margin-top:8px; width:100%; border:1px dashed #B7CBE6; color:#1d4ed8; background:#F5F9FF; border-radius:8px; padding:8px 12px; font-size:12.5px; font-weight:700; cursor:pointer; }

.pl-cases { display:flex; flex-direction:column; gap:10px; }
.pl-card { border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--panel); box-shadow:0 1px 3px rgba(0,0,0,.2); }
.pl-head { width:100%; border:none; display:flex; align-items:center; gap:10px; padding:11px 14px 11px 0; cursor:pointer; text-align:left; background:var(--panel); }
.pl-headedit { display:grid; grid-template-columns:5px auto 46px minmax(70px,1fr) 104px auto; gap:8px; align-items:center; padding:8px 12px 8px 0; background:var(--panel2); border-bottom:1px solid var(--line); }
.pl-bar2 { width:5px; align-self:stretch; flex-shrink:0; min-height:34px; border-radius:0; }
.pl-hash { color:var(--faint); font-size:12px; font-weight:700; }
.pl-caseno { color:#fff; font-size:11.5px; font-weight:700; border-radius:6px; padding:2px 7px; flex-shrink:0; }
.pl-casename { font-weight:700; font-size:14px; color:var(--ink); }
.pl-tag { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; border:1px solid; border-radius:999px; padding:1px 8px; }
.pl-spacer { flex:1; }
.pl-count { font-size:12px; color:var(--dim); font-weight:600; white-space:nowrap; }
.pl-count em { font-style:normal; }
.pl-chev { font-size:20px; color:var(--faint); margin-right:12px; line-height:1; transition:transform .15s; }
.pl-del { border:1px solid rgba(220,38,38,.4); color:#f87171; background:none; border-radius:8px; padding:5px 10px; font-size:11.5px; font-weight:700; cursor:pointer; margin-right:10px; }

.pl-body { padding:4px 12px 10px; background:var(--panel); }
.pl-drawerlbl { font-size:10.5px; font-weight:700; color:var(--faint); text-transform:uppercase; letter-spacing:.6px; margin:10px 0 3px; }
.pl-row { display:flex; align-items:center; gap:10px; padding:7px 8px; border-radius:7px; border-bottom:1px solid var(--line); }
.pl-row:last-child { border-bottom:none; }
.pl-row.out { background:rgba(255,152,0,.07); }
.pl-itemcol { min-width:0; flex:1; }
.pl-itemname { font-size:13.5px; font-weight:600; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pl-meta { font-size:11.5px; margin-top:3px; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.pl-badge { font-size:10.5px; font-weight:700; background:rgba(255,255,255,.07); color:var(--dim); border-radius:5px; padding:1px 6px; }
.pl-note { color:var(--dim); }
.pl-qtyv { font-size:13px; font-weight:700; color:var(--ink); width:42px; text-align:right; flex-shrink:0; }
.pl-check { border:1.5px solid var(--line); background:none; color:var(--dim); border-radius:8px; padding:5px 10px; font-size:12px; font-weight:700; width:58px; flex-shrink:0; cursor:pointer; }
.pl-check.green.on { background:#059669; border-color:#059669; color:#fff; }
.pl-check.dis { opacity:.4; cursor:not-allowed; }

.pl-toolbar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:4px; }
.pl-tbbtn { border:1px dashed var(--line); color:var(--dim); background:none; border-radius:10px; padding:10px 14px; font-size:13px; font-weight:700; cursor:pointer; flex:1; min-width:140px; }
.pl-tbbtn:hover { background:var(--panel2); }

.pl-loosecard { border:1px solid var(--line); }
.pl-loosehead { display:flex; align-items:baseline; gap:8px; padding:10px 14px; background:var(--panel); border-bottom:1px solid var(--line); }
.pl-loosetitle { font-weight:700; font-size:14px; color:var(--ink); }
.pl-loosesub { font-size:11px; color:var(--faint); }

.pl-item-edit { padding:6px 4px; border-bottom:1px solid var(--line); }
.pl-item-edit:last-of-type { border-bottom:none; }
.pl-ie1 { display:grid; grid-template-columns:minmax(0,1fr) 52px 80px 32px; gap:5px; align-items:center; }
.pl-ie1.with-rent { grid-template-columns:minmax(0,1fr) 52px 80px minmax(80px,.5fr) 32px; }
.pl-inp { border:1px solid var(--line); border-radius:7px; padding:6px 8px; font-size:12.5px; outline:none; min-width:0; background:var(--panel2); color:var(--ink); }
.pl-inp:focus { border-color:var(--amber); box-shadow:0 0 0 2px rgba(255,176,32,.12); }
.pl-inp::placeholder { color:var(--faint); }
.pl-ieqty { text-align:center; }
.pl-ienotes { width:100%; margin-top:3px; font-size:12px; color:var(--faint); background:transparent; border:none; border-bottom:1px solid transparent; padding:2px 4px; border-radius:0; }
.pl-ienotes:focus { border-bottom-color:var(--amber); outline:none; color:var(--ink); }
.pl-ienotes::placeholder { color:var(--faint); opacity:.6; }
.pl-no { font-weight:700; text-align:center; }
.pl-name { font-weight:700; }
.pl-cat { font-weight:700; }
.pl-x { border:1px solid rgba(220,38,38,.35); color:#f87171; background:none; border-radius:7px; width:32px; height:32px; font-size:17px; line-height:1; cursor:pointer; flex-shrink:0; padding:0; }

.pl-addrow { display:flex; gap:6px; margin-top:6px; padding-top:6px; border-top:1px solid var(--line); }
.pl-additem { width:100%; border:1px dashed var(--line); color:var(--dim); background:transparent; border-radius:8px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; }
.pl-additem.sub { margin-top:4px; }
.pl-adddrawer { white-space:nowrap; border:1px dashed var(--line); color:var(--dim); background:transparent; border-radius:8px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; }
.pl-invsave { white-space:nowrap; border:1px solid var(--line); color:var(--dim); background:transparent; border-radius:8px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; }
.pl-invsave:hover { background:var(--panel2); }

/* inventory picker */
.pl-invcontrols { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.pl-invseedbtn { border:1px solid var(--line); background:var(--panel2); color:var(--dim); border-radius:7px; padding:4px 10px; font-size:11.5px; font-weight:600; cursor:pointer; }
.pl-invseedbtn:disabled { opacity:.5; cursor:not-allowed; }
.pl-invcat-grp { margin-bottom:6px; }
.pl-invcat { display:flex; align-items:center; gap:6px; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; padding:4px 0 2px; }
.pl-invrow { display:flex; align-items:center; gap:8px; padding:6px 4px; border-bottom:1px solid var(--line); cursor:pointer; }
.pl-invrow:last-child { border-bottom:none; }
.pl-invrow input { width:16px; height:16px; flex-shrink:0; cursor:pointer; }
.pl-invname { flex:1; font-size:13px; font-weight:600; color:var(--ink); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pl-invmeta { font-size:11.5px; color:var(--faint); flex-shrink:0; }
.pl-sheetimport { border-bottom:1px solid var(--line); padding-bottom:10px; margin-bottom:10px; }
.pl-sheetrow { display:flex; gap:8px; align-items:center; }
.pl-sheetpreview { margin-top:8px; }
.pl-sheetstat { font-size:13px; color:var(--ink); margin-bottom:8px; }
.pl-sheetdim { color:var(--faint); font-size:11.5px; }
.pl-sheetchips { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:10px; }
.pl-sheetchip { display:inline-flex; align-items:center; gap:5px; border:1px solid; border-radius:6px; padding:2px 8px; font-size:11.5px; color:var(--ink); }
.pl-sheetactions { display:flex; gap:8px; align-items:center; }

.pl-drawergrp { margin-top:8px; padding:6px 8px; border:1px solid var(--line); border-radius:10px; background:var(--panel); }
.pl-drawerhead { display:grid; grid-template-columns:auto minmax(0,1fr) 32px; gap:6px; align-items:center; margin-bottom:6px; }
.pl-drawerchev { color:var(--faint); font-size:12px; }
.pl-drawername { font-weight:700; color:var(--ink); }

.pl-clear { display:block; margin:6px auto 0; border:1px solid rgba(255,107,107,.35); color:var(--danger); background:transparent; border-radius:8px; padding:8px 16px; font-size:12.5px; font-weight:700; cursor:pointer; }
.pl-clear:hover { background:rgba(255,107,107,.08); }

/* quote PDF import */
.pl-quotelabel { display:inline-block; cursor:pointer; }
.pl-quoteerr { margin-top:8px; font-size:12.5px; color:#DC2626; font-weight:600; }
.pl-quoteloading { display:flex; align-items:center; gap:10px; font-size:13px; color:var(--dim); padding:8px 0; }
.pl-quotespinner { display:inline-block; width:16px; height:16px; border:2px solid var(--line); border-top-color:var(--amber); border-radius:50%; animation:pl-spin .7s linear infinite; flex-shrink:0; }
@keyframes pl-spin { to { transform:rotate(360deg); } }
.pl-quotepreview { display:flex; flex-direction:column; gap:6px; margin-bottom:10px; }
.pl-quotecase { border:1px solid var(--line); border-radius:8px; overflow:hidden; }
.pl-quotecasehead { display:flex; align-items:center; gap:8px; padding:7px 10px; background:var(--panel2); }
.pl-quotedot { width:9px; height:9px; border-radius:50%; flex-shrink:0; }
.pl-quotecasename { font-weight:700; font-size:13px; color:var(--ink); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pl-quotecatetag { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
.pl-quotecasecount { font-size:11.5px; color:#94A3B8; font-weight:600; flex-shrink:0; }
.pl-quoteitems { display:flex; flex-wrap:wrap; gap:4px; padding:6px 10px; background:#fff; }
.pl-quoteitem { font-size:11.5px; color:#475569; background:#F1F5F9; border-radius:5px; padding:2px 7px; }
.pl-quoteitem.more { color:#94A3B8; }
.pl-quoteactions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.pl-quotecancelbtn { border:1px solid var(--line); background:var(--panel2); color:var(--dim); border-radius:8px; padding:7px 12px; font-size:12.5px; font-weight:700; cursor:pointer; }

/* P&L quote import preview */
.pnl-qpreview { display:flex; flex-direction:column; gap:6px; margin-bottom:4px; border:1px solid #E2E8F0; border-radius:10px; overflow:hidden; }
.pnl-qrow { display:flex; justify-content:space-between; align-items:center; padding:8px 12px; font-size:13px; }
.pnl-qrow.grand { background:#F0F9F4; font-weight:700; color:#047857; font-size:14px; }
.pnl-qsect { border-top:1px solid #E2E8F0; }
.pnl-qsecthead { display:flex; justify-content:space-between; align-items:center; padding:7px 12px; background:#F8FAFC; font-size:12.5px; font-weight:700; color:#334155; }
.pnl-qitem { display:flex; justify-content:space-between; align-items:baseline; padding:5px 12px 5px 20px; font-size:12px; color:#475569; border-top:1px solid #F1F5F9; }
.pnl-qitem span:last-child { font-weight:600; color:#334155; flex-shrink:0; margin-left:8px; }
.pnl-qnotes { font-weight:400; color:#94A3B8; }

/* crew autocomplete */
.cb .crew-ac-wrap { position:relative; width:100%; }
.cb .crew-ac-drop { position:absolute; top:calc(100% + 4px); left:0; right:0; background:var(--panel); border:1px solid var(--amber); border-radius:9px; box-shadow:0 6px 20px rgba(0,0,0,.35); z-index:200; overflow:hidden; }
.cb .copy-emails-btn { border:1px solid var(--line); background:none; color:var(--dim); border-radius:8px; padding:5px 12px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; transition:color .15s,border-color .15s; }
.cb .copy-emails-btn:hover { color:var(--amber); border-color:var(--amber); }
.cb .crew-ac-row { display:flex; align-items:center; justify-content:space-between; width:100%; border:none; background:none; padding:9px 12px; cursor:pointer; text-align:left; gap:10px; }
.cb .crew-ac-row:hover { background:var(--panel2); }
.cb .crew-ac-name { font-weight:600; color:var(--ink); font-size:13px; }
.cb .crew-ac-pos { font-size:11.5px; color:var(--dim); flex-shrink:0; }

/* roster tab */
.cb .roster-list { display:flex; flex-direction:column; gap:2px; }
.cb .roster-row { display:grid; grid-template-columns:1.2fr 1.2fr 100px auto auto; align-items:center; gap:10px; padding:10px 6px; border-bottom:1px solid var(--line); }
.cb .roster-row.editing { display:block; border:1px solid var(--amber); border-radius:10px; padding:10px; margin:4px 0; }
.cb .roster-person { display:flex; flex-direction:column; gap:2px; min-width:0; }
.cb .roster-name { font-weight:700; color:var(--ink); font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cb .roster-pos { font-size:11.5px; color:var(--dim); }
.cb .roster-contact { display:flex; flex-direction:column; gap:3px; min-width:0; }
.cb .roster-link { color:var(--amber); font-size:12px; text-decoration:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cb .roster-link:hover { text-decoration:underline; }
.cb .roster-rate { font-size:12.5px; font-weight:600; color:var(--green); font-variant-numeric:tabular-nums; }
.cb .roster-none { color:var(--faint); font-weight:400; }
.cb .roster-notes { font-size:11.5px; color:var(--faint); grid-column:1 / -2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cb .roster-actions { display:flex; gap:6px; align-items:center; justify-content:flex-end; }
.cb .roster-extras { grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:5px; padding-top:4px; }
.cb .roster-chip { font-size:11.5px; color:var(--dim); background:var(--panel2); border:1px solid var(--line); border-radius:6px; padding:2px 8px; white-space:nowrap; }
.cb .roster-sect-lbl { font-family:'Oswald'; font-size:11.5px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--dim); margin-bottom:6px; padding-bottom:5px; border-bottom:1px solid var(--line); }
.cb .roster-posbar { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.cb .roster-poschips { display:flex; flex-wrap:wrap; gap:6px; }
.cb .roster-managepos { border:1px solid var(--line); background:none; color:var(--dim); border-radius:8px; padding:5px 11px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; }
.cb .roster-managepos:hover { background:var(--panel2); }
.cb .roster-linkbox { display:flex; gap:8px; align-items:center; }
.cb .roster-linkurl { flex:1; background:var(--panel2); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:12px; color:var(--dim); font-family:monospace; }
.cb .roster-pos-tags { display:flex; flex-wrap:wrap; gap:4px; }
.cb .roster-pos-tag { font-size:11px; background:rgba(255,255,255,.08); border:1px solid var(--line); border-radius:5px; padding:1px 7px; color:var(--dim); }
.cb .roster-pos-sel { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
.cb .roster-pos-opt { border:1px solid var(--line); background:none; color:var(--dim); border-radius:999px; padding:5px 12px; font-size:12.5px; font-weight:600; cursor:pointer; transition:all .12s; }
.cb .roster-pos-opt.on { background:var(--amber); border-color:var(--amber); color:#0F1E35; }
.cb .roster-pos-opt:hover:not(.on) { border-color:var(--amber); color:var(--amber); }
.cb .roster-pos-chip { display:inline-flex; align-items:center; gap:5px; background:var(--panel2); border:1px solid var(--line); border-radius:999px; padding:3px 8px 3px 11px; font-size:12.5px; color:var(--ink); }
.cb .roster-pos-chip button { background:none; border:none; color:var(--faint); cursor:pointer; font-size:14px; line-height:1; padding:0; }
.cb .roster-pos-chip button:hover { color:var(--danger); }
.cb .roster-pos-add { display:flex; gap:8px; align-items:center; }
.cb .roster-pos-add .roster-inp { flex:1; }
.cb .roster-form { display:flex; flex-direction:column; gap:10px; }
.cb .roster-form-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
.cb .roster-form-col { display:flex; flex-direction:column; gap:4px; }
.cb .roster-form-col.full { grid-column:1 / -1; }
.cb .roster-lbl { font-size:11px; font-weight:700; color:var(--dim); text-transform:uppercase; letter-spacing:.04em; }
.cb .roster-inp { background:var(--panel2); border:1px solid var(--line); border-radius:7px; color:var(--ink); font-family:'Inter'; font-size:13px; padding:7px 9px; width:100%; }
.cb .roster-inp:focus { outline:none; border-color:var(--amber); }
.cb .roster-form-actions { display:flex; gap:8px; align-items:center; }
@media (max-width:700px){ .cb .roster-row{ grid-template-columns:1fr auto; grid-auto-flow:row; } .cb .roster-form-grid{ grid-template-columns:1fr 1fr; } }
.pl-empty, .pl-emptycase { text-align:center; color:#94a3b8; padding:14px; font-size:13px; }
.pl-empty { padding:34px; }
@media (max-width:560px){ .pl-headedit{ grid-template-columns:5px auto 44px 1fr 92px auto; } }

`;

/* ============================================================
   LOGIN + ROOT — the password gate in front of the app
   ============================================================ */
function Login({ onDone }) {
  const [mode, setMode] = useState("show"); // "show" | "admin"
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!password || busy) return;
    setBusy(true);
    setErr("");
    try {
      if (mode === "admin") {
        await loginAdmin(password);
        onDone({ scope: "admin" });
      } else {
        const r = await loginShow(password);
        onDone({ scope: "show", showId: r.show.id, showName: r.show.name });
      }
    } catch (e) {
      setErr(e.message || "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <div className="cb">
      <style>{CSS}</style>
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand login-brand">
            <span className="brand-tab">CALL</span>
            <span className="brand-rest">BOARD</span>
          </div>
          <div className="login-tabs">
            <button className={"login-tab " + (mode === "show" ? "on" : "")} onClick={() => setMode("show")}>Open a show</button>
            <button className={"login-tab " + (mode === "admin" ? "on" : "")} onClick={() => setMode("admin")}>Admin</button>
          </div>
          <p className="login-hint">
            {mode === "show"
              ? "Enter the password for your show. You'll only see that show."
              : "Enter the admin password to manage every show."}
          </p>
          <input
            className="login-input"
            type="password"
            value={password}
            autoFocus
            placeholder={mode === "show" ? "Show password" : "Admin password"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {err && <div className="login-err">{err}</div>}
          <button className="btn amber login-go" onClick={submit} disabled={busy}>
            {busy ? "Checking…" : mode === "show" ? "Open show" : "Sign in"}
          </button>
        </div>
        <div className="login-foot">Callboard · production hub</div>
      </div>
    </div>
  );
}

export default function Root() {
  const [auth, setAuth] = useState(() => currentAuth());
  if (!auth) return <Login onDone={(a) => setAuth(a)} />;
  return (
    <RosterProvider>
      <Callboard
        auth={auth}
        onLogout={() => {
          dbLogout();
          setAuth(null);
        }}
      />
    </RosterProvider>
  );
}
