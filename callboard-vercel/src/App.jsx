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
    rosterId: null, rateType: "day", rate: "", crewNotes: "", ...c,
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
  if (typeof e.audioUnlocked !== "boolean") e.audioUnlocked = false;
  if (typeof e.videoUnlocked !== "boolean") e.videoUnlocked = false;
  if (typeof e.briefUnlocked !== "boolean") e.briefUnlocked = false;
  if (typeof e.itineraryUnlocked !== "boolean") e.itineraryUnlocked = false;
  if (typeof e.hoursUnlocked !== "boolean") e.hoursUnlocked = false;
  if (typeof e.documentsUnlocked !== "boolean") e.documentsUnlocked = false;
  if (typeof e.diagramsUnlocked !== "boolean") e.diagramsUnlocked = false;
  if (typeof e.recordsUnlocked !== "boolean") e.recordsUnlocked = false;
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
    audioUnlocked: false,
    videoUnlocked: false,
    briefUnlocked: false,
    itineraryUnlocked: false,
    hoursUnlocked: false,
    documentsUnlocked: false,
    diagramsUnlocked: false,
    recordsUnlocked: false,
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
    audioUnlocked: false,
    videoUnlocked: false,
    briefUnlocked: false,
    itineraryUnlocked: false,
    hoursUnlocked: false,
    documentsUnlocked: false,
    diagramsUnlocked: false,
    recordsUnlocked: false,
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
            <button className="print-btn" onClick={() => window.print()} title="Print or save as PDF">
              🖨️ Print / PDF
            </button>
          </div>
          <main className="content" data-show={event.name} data-tab={SECTION_LABEL[tab] || tab}>
            {tab === "brief" && <LockWrapper canEdit={isAdmin || !!event.briefUnlocked} label="Brief"><BriefTab event={event} update={update} isAdmin={isAdmin} /></LockWrapper>}
            {tab === "schedule" && <ScheduleTab event={event} update={update} isAdmin={isAdmin} />}
            {tab === "documents" && <LockWrapper canEdit={isAdmin || !!event.documentsUnlocked} label="Show Documents"><DocumentsTab event={event} update={update} /></LockWrapper>}
            {tab === "itinerary" && <LockWrapper canEdit={isAdmin || !!event.itineraryUnlocked} label="Itinerary"><ItineraryTab event={event} update={update} /></LockWrapper>}
            {tab === "notes" && <NotesTab event={event} update={update} />}
            {tab === "audio" && <IOTab event={event} update={update} kind="audio" isAdmin={isAdmin} />}
            {tab === "video" && <IOTab event={event} update={update} kind="video" isAdmin={isAdmin} />}
            {tab === "diagrams" && <LockWrapper canEdit={isAdmin || !!event.diagramsUnlocked} label="Diagrams"><DiagramsTab event={event} update={update} /></LockWrapper>}
            {tab === "pull" && <PullTab event={event} update={update} isAdmin={isAdmin} />}
            {tab === "records" && <LockWrapper canEdit={isAdmin || !!event.recordsUnlocked} label="Records"><RecordsTab event={event} update={update} /></LockWrapper>}
            {tab === "hours" && <LockWrapper canEdit={isAdmin || !!event.hoursUnlocked} label="Hours"><HoursTab event={event} update={update} /></LockWrapper>}
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

/* ---- tab lock system ---- */
const TAB_LOCKS = [
  { label: "Brief",          key: "briefUnlocked" },
  { label: "Schedule",       key: "scheduleUnlocked" },
  { label: "Show Documents", key: "documentsUnlocked" },
  { label: "Audio I/O",      key: "audioUnlocked" },
  { label: "Video I/O",      key: "videoUnlocked" },
  { label: "Itinerary",      key: "itineraryUnlocked" },
  { label: "Hours",          key: "hoursUnlocked" },
  { label: "Pull List",      key: "gearEditUnlocked" },
  { label: "Diagrams",       key: "diagramsUnlocked" },
  { label: "Records",        key: "recordsUnlocked" },
];

/* LockWrapper — wraps a tab's content with a lock notice + CSS disable when locked */
function LockWrapper({ canEdit, label, children }) {
  return (
    <div>
      {!canEdit && (
        <div className="tab-lock-notice">
          🔒 {label || "This section"} is locked — view only
        </div>
      )}
      <div className={canEdit ? "" : "tab-locked"}>{children}</div>
    </div>
  );
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

      {isAdmin && (
        <div className="tab-access-panel">
          <div className="tab-access-title">Tab access — crew editing</div>
          <div className="tab-access-grid">
            {TAB_LOCKS.map(({ label, key }) => {
              const unlocked = !!event[key];
              return (
                <button
                  key={key}
                  className={"tab-access-row " + (unlocked ? "open" : "")}
                  onClick={() => update((ev) => (ev[key] = !unlocked))}
                >
                  <span className="tab-access-label">{label}</span>
                  <span className="tab-access-badge">{unlocked ? "🔓 Open" : "🔒 Locked"}</span>
                </button>
              );
            })}
          </div>
          <p className="tab-access-hint">Locked tabs are view-only for crew. You (admin) can always edit.</p>
        </div>
      )}
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

const ROSTER_DEFAULT_POSITIONS = [
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

function BriefTab({ event, update, isAdmin }) {
  const [emailsCopied, setEmailsCopied] = useState(false);
  const copyEmails = () => {
    const emails = event.crew.map((c) => c.email).filter(Boolean).join(", ");
    if (!emails) return;
    navigator.clipboard?.writeText(emails).catch(() => {});
    setEmailsCopied(true);
    setTimeout(() => setEmailsCopied(false), 2000);
  };

  const exportBriefPDF = () => {
    const it = event.itinerary || {};
    const stays = it.stays || [];
    const crew = event.crew.filter((c) => c.name);
    const schedule = event.schedule || [];

    // Map crew member name → hotel confirmation number + dates
    const confMap = {};
    stays.forEach((s) => {
      if (s.crewName) {
        confMap[s.crewName] = {
          confirmation: s.confirmation || "—",
          checkIn: s.checkIn ? fmt(s.checkIn) : "—",
          checkOut: s.checkOut ? fmt(s.checkOut) : "—",
        };
      }
    });

    const fmt = (d) => { if (!d) return ""; try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return d; } };
    const dateRange = event.startDate && event.endDate && event.startDate !== event.endDate
      ? `${fmt(event.startDate)} – ${fmt(event.endDate)}`
      : fmt(event.startDate) || "";

    const crewRows = crew.map((c) => {
      const stay = confMap[c.name] || {};
      return `
      <tr>
        <td style="font-weight:600">${c.name}</td>
        <td>${c.position || "—"}</td>
        <td>${stay.confirmation || "—"}</td>
        <td>${stay.checkIn || "—"}</td>
        <td>${stay.checkOut || "—"}</td>
      </tr>`;
    }).join("");

    const schedRows = schedule.map((day) => `
      <div style="margin-bottom:14pt;break-inside:avoid">
        <div style="font-size:10.5pt;font-weight:700;margin-bottom:4pt;padding-bottom:3pt;border-bottom:0.5pt solid #ddd">
          ${day.label || "Day"}${day.date ? " &nbsp;·&nbsp; " + fmt(day.date) : ""}
        </div>
        ${(day.items || []).filter((it) => it.time || it.activity).map((it) => `
          <div style="display:flex;gap:14pt;padding:2.5pt 0;border-bottom:0.25pt solid #f5f5f5;font-size:10pt">
            <span style="flex:0 0 80pt;color:#444;font-variant-numeric:tabular-nums">${it.time || ""}</span>
            <span style="flex:1">${it.activity || ""}</span>
          </div>`).join("")}
      </div>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Production Brief — ${event.name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;color:#111;background:#fff;font-size:11pt;line-height:1.5}
  @page{margin:0.65in}
  @media print{body{padding:0}}
  .page{padding:36pt}
  /* header bar */
  .hdr-bar{background:linear-gradient(135deg,#0D4F8C 0%,#0077B6 45%,#00B4D8 100%);height:6pt;border-radius:2pt;margin-bottom:20pt}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6pt}
  .hdr-logo img{height:60pt;width:auto;display:block}
  .hdr-right{text-align:right}
  .hdr-doc{font-size:18pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#0077B6;line-height:1}
  .hdr-conf{font-size:8pt;color:#888;margin-top:3pt;letter-spacing:.05em}
  .hdr-divider{border:none;border-top:0.75pt solid #0077B6;margin:14pt 0 16pt}
  .show-name{font-size:20pt;font-weight:700;color:#111;line-height:1.1;margin-bottom:4pt}
  .show-meta{font-size:10pt;color:#555;margin-bottom:20pt}
  /* two-col info */
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16pt;margin-bottom:20pt}
  .info-block{padding:12pt;background:#F4F8FC;border-left:3pt solid #0077B6;border-radius:2pt}
  .info-label{font-size:7pt;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#0077B6;margin-bottom:6pt}
  .info-name{font-size:11pt;font-weight:700;color:#111}
  .info-detail{font-size:9.5pt;color:#555;margin-top:2pt}
  /* section */
  .sect{margin-bottom:20pt}
  .sect-title{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#0077B6;border-bottom:1.5pt solid #0077B6;padding-bottom:4pt;margin-bottom:10pt}
  /* crew table */
  table{width:100%;border-collapse:collapse}
  thead tr{background:#0077B6}
  thead th{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#fff;padding:6pt 8pt;text-align:left}
  tbody tr:nth-child(even){background:#F4F8FC}
  tbody td{font-size:10pt;padding:6pt 8pt;border-bottom:0.25pt solid #dde8f0;vertical-align:top;color:#111}
  tbody tr:last-child td{border-bottom:none}
  /* schedule */
  .day{margin-bottom:14pt;break-inside:avoid}
  .day-label{font-size:10.5pt;font-weight:700;color:#0077B6;margin-bottom:4pt;padding-bottom:3pt;border-bottom:0.5pt solid #c8ddf0}
  .sched-row{display:flex;gap:14pt;padding:3pt 0;border-bottom:0.25pt solid #f0f5f8;font-size:10pt}
  .time{flex:0 0 78pt;color:#0077B6;font-variant-numeric:tabular-nums;font-weight:600}
  .act{flex:1;color:#111}
  /* footer */
  .footer{margin-top:24pt;padding-top:8pt;border-top:0.5pt solid #c8ddf0;display:flex;justify-content:space-between;font-size:8pt;color:#aaa}
</style>
</head><body><div class="page">

<div class="hdr-bar"></div>

<div class="hdr">
  <div class="hdr-logo"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAB30AAALsCAYAAADnHq1pAAAACXBIWXMAAC4jAAAuIwF4pT92AAAgAElEQVR4nOzdW5cb1Zn/8d/zX9y78woszgFsLGObzEqylovLyckNCSTkZDUk5BzakEzmIonlHGYmAUKTw0yGEKwmHJIQQE0IuUz1WkA4W21sMGDs0iuY7lew/xdVstRyn9QtaVfV/n7WqtUHy+2HRlJV7d9+9jbnnAAAkCSrPxdJmpRUkdTKjtjVP7zosSwAABAwqz9XUXpt0q8qaWKDP2a9xy4qve4ZxFp/p8X1EwD4ZfXnJpS+//db7fvridb58yQ7NiJe4XuLrv7hQc9FAAAA5xihLwBAkqz+XEPSwVX+eE5Sw9U/3BxfRQAAoEz6wtvVPpfSgfhtYylqvOb7vm4pDY6lvgDZ1T8cj6kmAMi9bHJyR+/n/RN69o+jnjFra3mQnPR9vexcQmgMAEDYCH0BALL6c5OSntrAQ5ckNZQGwNxMAgAASZLVn+sMvFeyo7eLqoyD8OPUCYt7g+HOID8D/AAKq6cTt/ecEWUfK5K2j7+q0lhS95yxuMrnrEoBAEDJEPoCAGRHnks0+A11W1JTUsMdZrARQPHZkW4XojtMlx3Qz448F6k7MF/JjrJ25RZRJxzuBMJJdixyrQbAl57rq064G2Ufd3krCivpnEMSdTuJ4+xjyx0mHAYAoAgIfQEgcHbkuZqko1v8MW2lN4SxpCY3hADyLguvKkoHIKs6vxNxSdK0O/zhxlgLAzyzI+e6rjrBbudzgt3i6+36ins/MtEFwFb1hLuRuhODWOmhXDpLTXe6hc91DXMeAQAgHwh9ASBwduS5pqQDQ/6xnRC41TkIggH40NeZ2AmxNtpZsiSpwvsXysqOPNcb7EYi3EW30ytWdzCf6zgAy2Tnj96DcBcdK51HWHECAIAxIfQFgMDZkecXNb4B3v5lB3v3E0rc4Q8lY6oDQInYkef7lwvsBFnD2Aduyh3+UGMIPwfwyo48X1E32GWAHpsxr+6yn7G4dgOCwPkDQ9TpFO6MB8TiXAIAwFAR+gJAwOxHz1clHfNdxwp6lx+UujeFHYt9fy5Jcj/8UDzasgCMS/b+NJF92Qlype5ygdJ4Bh1n3Q8/VBvDvwMMlf3o+UjdQfpIdPBidM4Pg3/IAD5QVNk1WNRzcP7AOMyre58fi3MJAACbQugLAAGzHz0/Lele33WMyYKWB8cA8qOi4XTljsK8++GHIt9FAOvpCXkj0YWFfCAMBgqAkBc51pkMHis7nzDRGwCAtRH6AkDA7EfPNyQd9FwGAOTZgvvhh6rrPwwYL0JeFFRnAL+l7hKfLffDDzExDxgT+9G55ZonRciLYuosEx2rd/95ziUAABD6AkDI7MfPJ8pvdx0A5IL7wYfMdw2A/ZhBepTaymHwDxjAB4bBfvx8pO75Y5fXYoDR6l1loiVp0f2A7mAAQDgIfQEgUNng8VnfdQBA3hH6whf78fNVSTUxSI9wrRQGJ+4HLBMNrMV+/PyEuhOFJsVEIaBzPknUEwiLCUYAgJIh9AWAQNmPX5iU9JTvOgAg79wPPkjoi7HJzs8M0gPrm1d3Wc8kO1ruBx9k8B5Bsh+/MKHu+eOA53KAollQek5JsqNzfpE4twAACoTQFwACZT95YUbS7b7rAIC8c98n9MVo2U8IeoEh6x+8b0mK3fcZtEe52E8IeoExm+/7OlanY/j7H4zHXg0AAH0IfQEgUPaTF2JJ+z2XAQC5R+iLUSDoBbyYk1R33/9ga91HAjnGOQTIpSVJDaXnGSYZAQC8IPQFgEDZT17gBAAAG0Doi2Gxn7zQ2aN3UtJ2v9UAQZty3/9gw3cRwCB6ziE1EfQCebYgKSL4BQD4cIHvAgAA45cNGAAAgBHrWXpzWtIuz+UASB21n7wQu+9/MPFdCLAWziFAIe1SOjljxnMdAIAAEfoCQIhMke8SAAAoM/vpC5GkmkwHfdcCYEXT2QHkjv30haqkaRnLNwMFNSlCXwCAB4S+ABAmOn0BABgy++m5jqy6WL4ZyDuuh5E79tMXaqKrFwAAAJtE6AsAQTIGuQAAGBL76T8rkuqS0ZEFABhIdg6pSZqWjHMIAAAANo3QFwBCZMwcBwBgq+w//hkpXX7zgO9aAADFYv/xz84SzmwDAAAAgKEg9AWAwGQD1AAAYJPsP/5ZE8tvAgA2Ibsfq0va77cSAAAAlA2hLwCEJ/JdAAAUyILvApAfWdhbF/v1AmUQ+y4AYeEcAgSl5bsAAECYCH0BIDzs5wsAG7fouwD4Zf/xzwlJk2KgHgCwCYS9QJC4hwAAeEHoCwChMUJfAAA2wv7zn9My1SVt810LgKFLfBeAcrP/zMJeI+wFAkToCwDwgtAXAAJi//nihGQMOgAAsAb7zxdrkuqcM4FSS3wXgHLiHAJALO8MAPCE0BcAwkKXLwAAq+gO1NOVVSDzI/zZVdHlDWCDOIfk3oLG031ZEc8BAADgCaEvAITEFPkuAQCAvLH/ejGSNCPTLt+1BKqtbtdl3PP93s8X3b//i/eumey50lHJjv7P94+rHmye+/d/iX3XgHLgHDJ2K50zFrW8s7Ll/v1fcrG8rv3XixNaPvk6yj72fp9JRiXDOQYA4AuhLwCEhU5fAAAy9l8vViQ1REg3ap3uqjj7OpaKOSA6SM32Xy9WlQ7qV7Kj8zXPN6AEstf4jHhNj8K8ukFu0jncv/9L4q+kzcnC57jnW/HKj1x23uh8jLKPTCgAAAAbQugLAGEh9AUABC/ruqlLut1zKWUzr+7gfKyCDtAPy1qdyT2dX5XsiESn1zgt+C4AxZVNGKpLOui3klJoKw12zx2cNyStEAxnz7uK0vNFRek5gzA4n9q+CwAAhIvQFwACYT97cULG3kIAgLDZz16syTQjwrWtmlfvIP33/C+9XCQrdH5Jyq7X0oH8KPtYFXtDjkIuln1FsWSvz2mZpsU5ZLPmlb73tSTF7nv5WIK5CLIwPFHfucN+9mLnXNE5dxAE+5f4LgAAEC5CXwAIB12+AIBgZYOiLMO5OUtaPkgfe62mxLIAJFbPoH4WNEXqDujzHN46giYMxH724qTScwiTMAbTCXk5d4xINulq2cQr+9mLkbrnjEhMUgAAIBiEvgAQDIt8VwAAwLjZz17KlnI2lnIeTGegvum+9wG6eD3KguBmdkiS7GcvReoO5hMCD47nNDbEfvZSNmHIeJ1tzJK671ex+94HmGDhQRawx0onKnSex5EIgccl9l0AACBchL4AEA46fQFgcInvArB59rOX6MzauM5Afaw06GWgPsfc9z4Qa1k38EuRpEmxtCcwFNmEoWlJh33XUgBtpeePBpOE8in7/9LS+SHwpJg4BABAqRD6AkAojNAXADYh8V0ABmc/f2lCUkOmA75ryblzHVnu3z7QXO/ByK/eENh+/lJF3QCY18DKEt8FIL/s5y9NZnu/M2Fodd2g998IeoumNwTOrpk654xJ0QUMAEChEfoCQACyGzkGLQAApWc/f2lSUkMMWq5lTulAPUFvCbl/+0CitJurdzB/UgTAvRLfBSB/zk0Y4rWyllkxUahU3L99YFHp874hnbuOipSeNxhD2JzYdwEAgHAR+gJAGOjyBQCUGoP162orDQIb2QAvAtA7mN8TAE+LJaCBZZgwtCbOHwHJAv2mpGn7+UtVpecMOoABACgIQl8ACIEp8l0Czpnf4OMWlS65NezHJu67H0h6v2F3vVQX+5V1HHHf/UB9pT+wu16KNvHzJrS5SReV7NjM32NGPoJjd700KWOwfhWzkhruux+IfRcCv5YFwHe9VJFUy44QzxssRwtJkt3FdgBrmJc0475LV2+osqW7a1J2rZWGvwd91gQAANZG6AsAQbCK5wJGbUkbG7xrKQ1INyLe6D/uvnvthh+bT+a7gELYQmCS+4Eyu+vlqtKAejUVLQ+hex9fFUEbPLG7Xp6QNCMZA5DLLSkN92bcd69N/JaCPMomgNUl1e2ulyeVDuoHE3q5715LtyKUPvetIa5j+s1KqnP+QK8s/G/aXS93On9ZNWJ1TCwCAHhD6AsAYSjK8s694W2cfezvYk0YgACGy3332i0PTNhdL1eUBsOd7ubO1/u3+rOBlWSTFZoKs0txNUvK9nIl1MJGue9e2xnIrygdxK+JEAwl1p0wRMdiDyYLYUOy64uGpEZ2Lcbyz324BgMA+EToCwAhsNzNwF1QGuQmSsPdRfedrYdO2CQafTEE2QBhkn25rLvZ7j4XCEdKA+GqCOqwBXb3y3UZy9L36Ia932GgEZuTvY9P290v15UO4k+rnIP4bd8FwB+7++WqjAlDPTh/YNOyiaM1u/vlzp7xdfHaAgDAK0JfACg5u/vlyHMJS0qD3VhSy32n6EshAxiU+865QDjufC8LgqtKg+BJMUCEDcgGFZuig7yDwXoMXfZcqkuq290v11S+QfzEdwHww+5+eVrSvb7ryJFZSdOcP7BV2XOoIamRjT/UFe612pLvAgAAYSP0BYDy87G0c1vpoHzsvnNt7vczBTB+PUFwU2lnWUXdADiYfSWxcdkgYlPl7DzcjHTPxe+wDCdGx33n2obSQfya0gkGvP5QOEwYOg/nD4xMNsk7yq7t6wpvGXVWMAMAeEXoCwDlVxnjvzUnqUHQC2BQ2cBjQ2m40FkijgAYkrLlnMVyzpl5pZ1ZDCpibNx3rm3Y3S83VY5ln+lqDIjdzf7vPeaVhr2x70JQftm1fS27hqsrvPAXAAAvCH0BoOxsLJ2+6WzxO5ktXkjs6YucWbZE3D0vVyTVssPHgG3s4d9Exu55eUJSQ0b4r3S5wGl357UN34UgTJ1ln+2el2eUdv0WdQCfCROBsHtenpaxnLM4f8Cjc+HvPYS/AACMA6EvAJSejXIZs7Tb6M59DJ4VGqkv8iubTFKXVLd7XqmpfHtLYhV2zytVyRqSdvmuJQfmJNXcnfvoUIR37s5rFyXV7J5XZpRO0OE1ilyxe16ZkDQjGeGSdJ+kOucP+JZd09fsnlfqKnf4y2sNAOAVoS8AlFg6YD4SS0oHD2ZG9PMB4Dzuzn0NSQ3C3/Kze16ZVBomFXkJ2WFYUhr2sm0Ccieb9Fe1e16ZVvqeHPrrFTmQBb6xmIywoHRybuy7EKCXu3Nfom7421D59tpmQjwAwKv/57sAAMBIVUbwMxckRQS+AHxxd+5ruDv3VSQdUhqKoUSyAOkpESDNSaoQ+CLvsmvCqtIVYIog8V0ARiOb8JqIwPeIu3NflcAXeebu3Je4O/dFkq5TOsYAAACGgNAXAMrMVJVJQzwWZIpYzrlkhvscKf6BwnB37puRqSLTHM+JcrBfvNKQ6V7v7wN+jyWZptyd+yZZjhNFcW7w3nQoB6+h9Y5kZL8IeGO/eKUm0zGZtuXgOebrWJBpt7tzX30Iv1JgLNyd+2J3576qTFPZNZDv19HWDwAAPCL0BYByi4b4s9IO3zsYgAaQH+6OfYvujn2TkqZE129h2S9embBfvNJSefd326gFSVV3x76G70KAzXB37JuRtFt0bWGM7Bev1CUd9V2HZ0fcHfuq7g4m56KYsmufitJ9qAEAwCYR+gJAuVWG9HMIfAHkWjZQFElq+60Eg7JfvFJVuv9Z6MtxzmYD9onvQoCtyEKnSNKs51IQAPvFKw1Jh33X4VFb0nXuDrp7UXzZZM5pFXvJZ8ZMAABeXeC7AADACJltH8JPWZIUuUN7uXkpK2MNKpSDu2Nfy+59tSopFgFiIdi9r1ZlFov9e6fcob0N30UAw5JNFKzZva+2JN3rux6Uj9376oSkpsz2+67FozlJNe7TUDbujn2xpKrd+2pdxZvUQbc9AMArOn0BoKTs3lejIf2oSQYSABRF9n4VqbjdAcGwe1+tKQ3oQw58lyTtJvBFWblDe2ckXa8cLb/vDu2NfdeArckC31hSyIHvIXdoL/dpKDV3aG9dbBkAAMBACH0BoLyqQ/gZRxgYA1A0BL/5lwW+RxV24LsgqeIO7aUjBKXmDu1tKn1Pzk3wi+JiRY9zk4VmfBcCjIM7tLflDu2tSjriuxYAAIqA0BcAyspUkUlbOOazmbUou609T8p3oBTcob2LMkUyLW3xOUEHzZDZzKs1mY56f637PeZkbJ2AcLhDe1tDek/mPB8wm3m1KlMs0y7vzyM/x7yMyUIIkzu0ty7TdTK1c/Ba5DwDAMgtQl8AKK+tdPouSaoNqQ4A8MJN712UNLnFn8HA6hDZzLkO35DNuum9k9nzEwhG9n4aiY5fbILNnOvwDXWFiFk3vTfi3IGQuem9sdJxjjnPpQAAkFuEvgBQXlsJfetuem8yrEIAwJdscOiI7zog2cyrDRH43uem99Z8FwH4QvCLzSDw1RTnDiDlpvcuuum9k5IO+a5lFYnvAgAAYSP0BYASspnXJiTbtsn1iObdNHtEhcX3+ld5O1A+NiNZm+eDPzbzWkOyg/5f316PKTe9d3rrv02g2NLg1yLJljjPYz0281pVslibv7cp8rEk2fVuem9jGL9LoEzSMQu7zt+5ZOWDyfMAAN8IfQGgjEzVLdynMCAdGv/3xvk6UDpues+iTHWeD37Yfa81ZDro/bXt95hy03saW/9tAuXgpve0ZKp5eC3Oj+e/EMNg973W2cN3Ww7ex8d9LMkUuek9zeH8NoHycdN7YqX7xS/k4DWbHgAAeEboCwDlVNnk35t1t+9h/0oApeNu39OQ1PZdR2jsvtcakg76rsOzqez5B6CHu31PU/ldnhOe2X2vhbyk85KkiPsyYH3Z6ySStOC5FAAAcoHQFwDKqbKJv7MkqT7cMgAgVxq+CwiJ3fdaTQS+BL7AGtzte2YkzfquA/kSeOC7IKlC4AtsnLt9z6K7fU9VnE8AACD0BYBSSpc4GnQpohl3+57ES73wy/cSWHk7UF6mBs+H8bBfvlaT6aj317Pfg8AX2AjTtMa5NCdyzX4Z9JLOCzJF7vY9i8P5bQJhcbfvqck06/V1DACAZ4S+AFBOEwM+fknSzCgKAYC8cN/ek4glnkfOfvlaTdJR33V4NuW+TeALbIT79p5FSTWl16MImP0y+A7fKHs9ANgk9+09NdHxCwAIGKEvAJTTrgEf32CAAUAgYt8FlBmBryRplsAXGIz79p6W2GYkaPbL1yoi8OV+DBgCj8Evk5cAAN4R+gJAKQ28DhFdvkHzv5Zdvg6Um7V4PoyG/fL1ano+8f0a9nrMZgONAAbkvr1nRrJ5zvPhsV++PiFZU7JtOXgfH/exIBmBLzBk6fWYzY759cxe3AAA7y7wXQAAYLjsV69HA45nzblvXZOMphoUAuOfCImJwZgRsF+9nu7BGGaHVse8+9Y1Nd9FAIVmqklqKez3kqDYr16fyM4fg65UVAZLkiL3rWsIfIERcN++pma/er2qMN9fAACBotMXANDwXQAAoLjsV69PSGoq7JBmQdKk7yKAossmIo5yBZp4hD8bm9NQmIEMgS8wHpHS6zQAAIJA6AsAYWu7b13T9F0EAIyL+9Y1se8ayiQLfGNJ2z2X4tOSpEkG7oHhcN+6pi6p7bsOjJ796vWGpAO+6/CgE/iy+ggwYtn1WU3stwsACAShLwCUzWDbzhD4IgdbmeXsQPlt/PlA6LAe04xMu7y/bv0eEdskAENmqnGeLzf79evTMh3MwXu4j2OawBcYH/eta1ojPa9wjgEA5AihLwCEreG7AADwYKNLvCWjLKLo7Nev1yUd9F2HZ1PumwzcA8PmvnlNLGnedx0YDfv165OS7vVdhydT7pvXNHwXAYTGffOapqT7fNcBAMCoXeC7AADAsG14emnbfXM3A9UQU5IRHmMZ3i2yXx+rSXbYdx2ezbpv7m74LgIoL6tJOuu7CgyX/fpYVbKG7zo84bwBeOS+ec20/fpYpDD3EQcABIJOXwAoG1OywaWHWNoZKf9L3OXrQPlt/H0SK7DfHKsqXdbZ/+vV37Eg0/QQfp0AVuG+uTuRaZbzfHnYb45NyNSUaVsO3sfHft5w39xdG8ovEsDmjXqZZwAAPCP0BYCScd/YnUha2sBDG6OtBAByK/FdQFHZb45NSGpK2ua7Fo+WJNXcN3bTMQ6MXt13ARiqWNJ230V4sCQp8l0EAMl9Y3dL0hHfdQAAMCqEvgBQTut18c5nNzsAAAyiqTAH7HtNcw4FxiObzDjnuw5snf3m2IzCXVI1YqIQkB/uG7vrktq+6wAAYBQIfQGgnOpavdt3SVJtbJUAQP7EG3wcwV4P+82xuqT9vuvwbM59g/0YgTGb8V0AtsZ+c6wm6XbfdXhyiIlCQC7VRvAzea0DALwj9AWAEnLf2J3IFMk037fHzKxM1axrAkj53+MsXwfKb+N7+ia+Sswb++9jkUyHvb8+/R5tGZOmgHFz39gdK91Hm/N8Adl/B70P/Jz7xm4mLQA5lJ1b+sdLtnrQ0Q8A8O4C3wUAAEbDfX13S+wdBQDncV/fndh/H2tr/WWK4zGUk3v23+f28Q1dzX2d5TkBT2YkHR3Cz+E1PEbZ+aOhMPeBZ3UlIP+mJR3zXQQAAMNEpy8AAMHz3waRrwNhsHid50I7mzwDWVOybf5fm16P+9zXd8db/10C2BxrSrY0hNcy7+tjZTOS7crBe7iPY5KJQkC+pdf6Njvc1z4AAH4R+gIAEDrvY2I5OxAGU32d50LDX3H5Yf/Tqsu03/vr0u/Rlqm+9d8mgM1yX68uytTkPF8c9j+tmkwHc/Ae7uO4z329Gg/j9whgxNa/J+AcAwAoFEJfAAAABMd9rZpImlK6/GK/Ofe1an2sBeWQ/U+rKumw7zpyoOa+VqVbC/Cv4bsAbEx2/gh1L9u2xEQhoCiye4I533UAADAshL4AAAAIkvtatSGpKumQpCPZMeW+Vp30WVce2P+02Mc3Neu+RrcWkAfZa7Htuw5sSENh7uMrMVEIKKJQJ6kAAEroAt8FAAAAz1iGCgHLZvcz0NMvXc54u+8yPFuSNO27CAA9TE1Jt/suA6uz37ZmZNrluw5P7nNfZaIQUDTua9XYfttakIJ97wIAlAidvgAAAADOsd+2JkWoIkl191W6tYCcYQWCHLPftiKFe/5YEss6A0XGJFAAQCkQ+gIAEDzjWHYA4bLfLkxI1vD/OvR+LLivVhn8A3Im7aK0Jc7z+cP5w2pMFAKKzJrDeS8AAMAvQl8AAAAAHQ2Fuw9jL5Z1BvIr9l0AVlRXuNsCzLuv7qILHSgw99Vdi5JmfdcBAMBWsacvAAChY0IyAEn2vwuRTAd815EDc+4ru2LfRQBYhSmWeK/Kk+z8EeqyzpJU810AgCFI940/6LsMAAC2gk5fAAAAIHD2vwsTSrt8QZcvkHex7wLQxflD97mv7Ep8FwFg69xXdjWV7s8NAEBhEfoCAAAAqCvcZTl7zTJ4D+Sb+8qulhiUz5O6wj1/LCn97wdQHrHvAgAA2ApCXwAAACBg9r8LVSnoZTk7lkSXL1AUrU3+vWSYRYTO/nchUtjnjxn3lV2LvosAMFTszw0AKDT29AUAIHTs6QuEzYJelrPXjLuNwXugENJ9ffcP+tfcbXTyD1XY54+2pBnfRQAYMqPTFwBQbIS+AAAEj9QXCJXdf3xasl2+68iBJTF4DxSIbbbTF0Ni9x+vSxbqss6SVHe3Xc1EIaBk3G27Erv/eFvhLlsPACg4lncGAAAAAmT3H58QexF2zDB4DxRK4ruAkNn9xysKezn8trvt6obvIgCMTOy7AAAANovQFwCA0BnHsgMIhWlGpm3eX3P+jyUZXb5Akbjbrm5xjveI80d9CL9FAHllijf9/gAAgGeEvgAAAEBg7HfHq5IO+q4jJxruy3T5AgXU9l1AiOx3xyNJB3zX4VHbfZkuX6Dk2EIAAFBYhL4AAABAeOhs7eJ3ARRT4ruAQDV8F+BZ3XcBAEbLfflqQl8AQGFd4LsAAADgGctQAUGxB45PyrTfdx05Meu+dHXiuwgAm2BKJN7LxskeOF6XabvvOjxacl+iyxcIgmlenGMAAAVE6AsAQPBIfYGwGJ2tXfwugMKyZMC/sDCKKkJhD7wxIdm07zo845wBBMNaIvQFABQQyzsDAAAAgbAH3qhJQXdp9Zp3X9rJ8n1AONi7e2vqkrb5LsKjJRH6AiFJfBcAAMBmEPoCAAAAAUi7tNiLsEfDdwEAtoQQd0zsgTcqkm73XYdnTfelnTzngHAwMRAAUEgs7wwAQOhY3RkIg2ladPl2tN2tOxu+iwCwBTbwgHwyijKCYEwYEpOmgLAY5wwAQDHR6QsAAACUnP3+jQlJoe/F2KvhuwAAY5f4LqCI7PdvRJIO+q7Ds3l3687EdxEAxmeTr/l4yGUAADAwQl8AAACg/KYV9l6M/Rq+CwAwdizVuTl13wXkQMN3AQC8aPsuAACAQbG8MwAAoTPWdwbKzB48MSEzuny75twtOxLfRQDYosGvX5IRVFFq9uCJSGb7fdfh2ZK7ZUfDdxEAPDBLNNjWKEwuAgB4R6cvAAAAUG50+S7X9F0AgKFYHOCxS+6WHQzGD67uu4AcaPguAIA3yQCPbbtbdgxyXgIAYCQIfQEAAICSsgdPsJfvcnRsASUxYIjLZI8B2YMnIkmhd/lKhL5AyDjPAAAKh+WdAQAIHas7A+VldPn2YUAOKBPTgqRdG3gkr/1BGV2+khbcFB3iQLBM8QCPnhlVGQAADIJOXwAAAKC8ar4LyBkG5IByaWzgMW03tYPQdwB2lC7fTMN3AQD8ySZ9tDfw0Pvc1I5kxOUAALAhhL4AAABACdnREzVJ233XkSNtOraA0mlIWlrnMbXRl1E6bAuQYrIAgPXeDxfE/ucAgBwh9AUAAADKqe67gJxh8B4oGTe1Y1FrD8hPuakd8ZjKKQU7eqIi6YDvOnJgns49ANlKEVM6f4LRkqQjbmpHNTsXAQCQC+zpCwBA6IxNfYGyscbJSZnR5btcw3cBAIbPTe1oWONkorSjt5J9uyVpxtWuSvxUVWBmdd8l5ETDdwEA8jLLbewAACAASURBVMFN7WhIaljjZFXShKRFV7uK1WMAALlE6AsAAACUD0tzLtdmcA4oL1e7KpYUey6j8KxxsiLpoO86coLVIQAsw7UkAKAIWN4ZAAAAKJFs0H6/7zpyhsF7AFhfzXcBObHgalexXCsAAAAKh05fAABCx+rOQLkYe/muIPZdAADkmc2enJCxSkSm4bsAAAAAYDPo9AUAAABKwmZPTkia9F1Hziy5g1fR6QsAa5uUtM13ETnBOQMAAACFROgLAAAAlEdNDNr3i30XAAAFQJdvqu0OXpX4LgIAAADYDJZ3BgAgeKzvDJSHMWh/Pjq2AGANNvtmJNku33XkBOcMAAAAFBahLwAAoSPzBUrBHnozkmm77zpyKPZdAADkmqnmu4QciX0XAAAAAGwWyzsDAAAA5VDzXUAOLbgvXpn4LgIA8soeenNC0kHfdeSF++KVdPoCAACgsAh9AQAAgILLBu0nfdeRQ7HvAgAg52q+C8iRed8FAAAAAFvB8s4AAISO5Z2B4jNNStrmu4wcin0XAAC5ZmIv+K7YdwEAAADAVtDpCwAAABQfg/Yri30XAAB5ZX94syqxF3yP2HcBAAAAwFbQ6QsAQPBo9QWKzP7wVkWyXb7ryKEF94UrFn0XAQD5ZUwY6uG+cEXsuwYAAABgKwh9AQAIHZkvUGzGXr6riH0XAAC5xvmjF/v5AgAAoPBY3hkAAAAoNjq1Vhb7LgAA8soefou94JeLfRcAAAAAbBWhLwAAAFBQ9vBb7Me4uth3AQCQYzXfBeRM7LsAAAAAYKsIfQEAAIDiqvkuIKfa7vPs5wsAK7GH35qQdMB3HTnT8l0AAAAAsFXs6QsAQOjY0xcoLvZjXA2D9wCwGs4d/Rbc55goBAAAgOKj0xcAAAAoIHuEpZ3XEPsuAAByjNB3OSYKAQAAoBTo9AUAIHi0+gLFZAzar44BfABYgT1yakIylnZejnMGAAAASoHQFwCA0JH5AsXE8pyrcp99f+y7BgDIJc4dKyH0BQAAQCmwvDMAAABQMPboqYqkXb7ryKkF3wUAQI4R+vZhohAAAADKgtAXAAAAKB4G7VeX+C4AAHIs8l1AzrR9FwAAAAAMC6EvAAAAUDyR7wJyjGU6AWAF9uipSUnbfNeRM5wzAAAAUBrs6QsAQOjY0xcoHtMB3yXkWOy7AADIJWPC0AoIfQEAAFAadPoCAAAABWKPnWJp57UlvgsAgJzi/HE+Ql8AAACUBp2+AAAEj1ZfoFgs8l1BnrmbL0981wAAeWOPvV2RbLvvOnIo8V0AAAAAMCyEvgAAhI7MFygWo1NrDfO+CwCAXOLcsSL3mcvp9AUAAEBpsLwzAAAAUBD2x7crkujUWl3iuwAAyKnIdwE51PZdAAAAADBMhL4AAABAcUS+C8i5xHcBAJBTB3wXkEOJ7wIAAACAYSL0BQAAAIoj8l1AzrFMJwD0sT++HfmuIac4ZwAAAKBU2NMXAIDQsacvUBxG6LuCBUmL2eeJxzoAIJ84d6xmcf2HAAAAAMVB6AsAQPBIfYEisD+9U5EshP18l9TtvkrUDXJb6g7Qt9ynL2OwHgA2xCLfFeRU7LsAAAAAYJgIfQEAAIBiiHwXsEWdjtxFrRDquk9fFnuoCQBCsN93AQAAAABGj9AXAIDQ0egLFIOp6ruEVawU5na6chfdTZexZyIAeGJ/fifiWm9l7qbLYt81AAAAAMNE6AsAAAAUQ+Th35zPPp4LcbPPGSwHgGLI64QhAAAAAENG6AsAAAAUw64h/7xOh26SHZ1Al+5cACiPyHcBObXguwAAAABg2Ah9AQAIHUv+Ablnj29qec5Ol27c97HlbrxscetVAQByz1SXNKO043ei7+M2f4V5x3kQAAAApUPoCwBA8Eh9gfyzlZbnXDHUdTdeGq/wWABAgNyN51ZuiFf6c3v83ZXC4BBCYUJfAAAAlA6hLwAAAJB/LUnXSYS6AIDhcTdeOmgoHGV/tH/UtY0Y2xgAAACgdAh9AQAAgJwj6AUA+LBWKGyPv9vfGVzJjrJ3CQMAAAC5ROgLAEDoWN0ZAAAAA3I3Xrqobhjc7P9z+8u7UfZppOXB8PaRF7e+xHcBAAAAwLAR+gIAAAAAAGCo3KfOrVIR9/+Z/eXdTgDsq0M4GdO/AwAAAIwNoS8AAAAAYEVZMDOxzsM28phe0aYLWt9m9hldkLQ47EIyiQYLl1pav5aW+9Slo6oXGAv3qUtbSp/vq3UIV7Q8FN41tuIAAACAgiL0BQAgdMb6zgBQNPbE6WiFb3eWT93o96X1lloN4xwxyjBpMyH0uuyJ06v90ZLSIG0liVYOoBdX+Tst98lLCJcxdj0dwsvYE6crSt+zInXf1zbbHZxspjYAAAAgzwh9AQAAAGAMVghqV+qQ7X/MhOhww8Zt0+pB88AB9Arhclvnh2XJCt+L+x/jPnlJ/2OAgWTPoUR9zy974nTvfsEVpe+jFa0xoYXnIwAAAMqI0BcAAAAANqAvtO3vnl3pa8JalM12nR+krRQmH+7/Rl+A3B8e93cbJ31/TtcxVpU9N+KV/ix7365og2EwAAAAUGSEvgAAAACCYk+c7u2wrWRHR9TzeUWEA8AorBQeH1jrL/SExv1LWPfug7wsPHafvCTeSpEoPp4DAAAACAmhLwAAoQtiu0YAZWZPLuvAXe3zbjci73tAkfUvYb3qstX25LLu4gV1w+HeoDhRt6s4cTew7C8AAACAYiL0BQAAAJAr9uTp3qWSK+p24vZ26A68PymAoPUut76RoHi1kDjOPi66Gy7p7TgGAAAAAK8IfQEAAACMhT15blnl3lCXIBdAHq0WEp/br3iVgDjOPibqdhC33A3sSQwAAABgtAh9AQAInbHOKYCtsafeqyjtxl0pzJ1QJzzh/QZAOa3bRWxPvSct3484zj4m2SF3/cWxAAAAAGCTCH0BAAAArMqeeq8T3lZ0frBLZy4AbFzvfsTnvX9mwbDU7RxOsmNRWVhMMAwAAABgNYS+AAAAQKBW6NAl0AUA/zqdw5sJhhfd9Rez1zAAAAAQIEJfAABCx2qrQGlZ873eILf3Y0XSdl7/AFBYqwfDzXPB8Hz2Me772HKTF7PHMAAAAFAyhL4AAABAQa0R6laVLiMKAAhX/1LShzt/kAXDnW7hVvYxliQ3yRLSAAAAQBER+gIAAAA5Zc33OgFupe8g1AUAbFV/t/BhadVO4e7y0ZMsHw0AAADkEaEvAADBY31XwCdrnunv0o2yj7t4fQIAPOrvFJYkWfOMJLWV7iXc6RLOAuGL4vGVBwAAAKAXoS8AAKEjUwJGzubO9Ae6ne5d9tUFABTR9uxYHgjPnZGkJaUhcKKeYNgdIBAGAAAARonQFwAAABgCmztTUXfp5d6P233VBACAB9uUhsEbDYQTd+AilowGAAAAtojQFwAAABiAzZ2JtHxv3Yq6+yICAIDVrRUI9y4Zfe6jO3BRMs4CAQAAgKIi9AUAIHQsLQucx54+17Ubqbscc1XSNl4zAACMxMpLRj99RpLm1d07OA2DP0F3MAAAANCL0BcAAADBsqfP9C7F3Nl3d/9afwcAAIxd59x8oPONLAzudAfH2cfEfYK9gwEAABAmQl8AAACU3grhbkUsyQwAQNGd1x1MGAwAAIBQEfoCABA6Y61alIf99ezK4S7PcwAAQnJ+GPzXs9JKYfDHL4zHXRwAAAAwCoS+AAAAKBz769mKunvudj5nWWYAALCWjYTB6Z7BH7+QPYMBAABQKIS+AAAAyDX769lIy7t3q5K2eSwJAACUy2ph8IKyEFhZIOw+fuHi+MsDAAAA1kfoCwAAgFzo695l310AAODbLnWvRQ5Lkv317JLSIDhWGga36AoGAABAHhD6AgAQOrY6hQf2zNnert30MLp3AQBA7m1T2hHc7Qp+ZllX8LnDfYyuYAAAAIwPoS8AAABGyp45G6kb7lbE3rsAAKB8Ol3BBzvfsGfOttUNgWMRBAMAAGCECH0BAAgerb4YDnsmmVB/9660i+cYAAAIVGev4APqLA/9TNK7PHTWEVxJPNUHAACAEiH0BQAAwMB6At5I3YB3u8+aAAAACmCF5aEJggEAALB1hL4AAISOJswFpQNsTffRSuy3lPyyvyWRuuFuJCPgBQAAGJLzg+C/rRAEf5QgGAAAAKsj9AUAAKFpKwt5JcXuoxX2VevTF/BmSzQDAABgjFYKgs/fI5hrWQAAAGTMOee7BgAA4JH9Lakr22OspJaUDorFSrt5E5/F5I39Lalo+RLN+9d6PAAAAHKlM6Gx0w0ce60GAAAA3tDpCwBA6Mq5vPOCOp28H2Hgq8OeXbYPbySpKtM2nzUBAABgS7ZLOpgdsmcTSZpXT0ew+wiTHgEAAEJA6AsAAMpgSVnIK6npPsIyd5JkzyadgLfzkX14AQAAym/5stDPJp2Vb7rLQnO9DAAAUDos7wwAQODs2XZdxVzeudPN23Qf2d7yXYxv9mx7QssDXpZpBlBEC5KKFkRUJVZNAFA4C+qGwLH7yPbEazUAAADYMjp9AQAIXXGWd17ezfuv24sWCgyV/b3d2YM3khTJ6OIFsKL5df483sDP2MhjJEnuX7dv+LFIZe/nExt8eCU7tvIYQmoAkrQrO9Jlof/eXtYNzPs5AABA8dDpCwBA4Ozvue707Xbz/mvY3bz293ak5Z28DNgDxbdSV+ui0gH3fqt9n6AVQ7NGAN3ZE75fRSsHzKw2AZRDZ2/gWGkQHPSkSwAAgLwj9AUAIHA5C307HQadoDfIgSX7+7mlmiOlg+wMngP50d85m2RHr5bOD3Nbob6nAdKqgXLU9/VK4TKdyUB+tJUFwEpD4MRnMQAAAFiO0BcAgMDlYE/ftrp788Ye6/DGnm1XtDzk3eWvGqDUlrS8W7a/e/a8r9kzHMiX7JxZ6flWf1Dc/3VFYgsEYEQ6EzZjpfsCc84cAXu2HWWfRms8bBgSnT+RbaNa7iNMbtsoe7a92goaKxlkG4i1xOLaFgBKj9AXAIDA2bNJXeMPfRckNSQ13UcqyZj/be/s2aSibsgbicFoYKtm1R2kTHo+l/tIJR57NQByy55N+gfPo57PK1oeKLPSBjCYzuSqWFLMOXjz7NkkkjQt6YDnUkalfyLeRqy0kso4VbTylgYrPS7P93dLSiddT7uPVAjqAaBkCH0BAAic/W0soe/yZZs/GtbNpf0t6ezD2zlYphIYruvcRxlYBjA62bm8ExZX1B347+/WIigGlptXJwTmXL0h9rekJumo7zpQem1J1dDuzQGg7C7wXQAAACitzp5fTffRStNzLWNFyAsAQLm4j1YGXg7T/pZEPV+u9PmE2NIB5bc/Ow7b3xKJEHgjZnwXgCBsl1QTzzcAKBVCXwAAQjfcVT86+/M23McuDGavIHvmLCEvAABYpi/Qild5mCTJnjnb2zFcUbeTuNNhTECMsuiGwM+clXpD4I9dGPsrKx+y+wruJTAukQh9AaBUCH0BAMBWdffn/diFid9SxsOeOVsRe/ICeRJpnUAFAPLMfezCRW3wfSy7DqlkX/aGwpEIhlE8q4XAzZAmkfZgqV2M08T6DwEAFAmhLwAAodtco++cOoMxHy9/0Gt/PTshaVKEvAAAwLNskl2SfRl3vm9/PRtJ+sfYCwKGqxsC//XskrIuYEmx+3j5Q2D3sQsT++vZtrjfwHgEtQ0TAISA0BcAAGzUnNKbwqb7+IWlnoGehbxRz0HXDAAAADBe2yQdyA5lIXBT3RA48VbZaE1Lesp3ESi9JaUrdgEASoTQFwCA0K29p2836P3EReUOep8+E6kb8u73WQuCtqB0Wb9EdJUPIvJdAAB451ziuwRgxLZJOpgdsqfPtNUbApfkfsV9/MKmPX1mSuleq+zvi1FYkhSV5TUDAOgyt/ZALwAAKDl7+kxd0uHsy97Z86UOeu3pMxUtX7KZARWM2pKkltJQt7M8YSxJ7hMXxf0PtqfPxGICwkbNu09cFPkuAgB8s6fPMMiDkC0ou5dZ6dqqaLL7lWml9yxMBMSwzEqqu09clPguBAAwfIS+AAAEzubOTEuqSmq6AxeVdk8fmzvTWbK5E/QycIJhayvt0O0cnXB30R24aOA96Gxu2YQMrK3tDlxU8V0EAPhmc4S+QKZ3P+CmO1DsgMvmzlQkVVb4o6qkib7vTWTf73zOVjVh6L8XUd/nktRyB8o7sRsAQOgLAABKzObOVNUNeemYxFb1d+puKdRdD6HvYNyBi8x3DQDgG6EvsKpzS0GXeaLrWmzuTKRuINw5mAhbPJ17kjj7mIziXgQAUEyEvgAAoDSs+d6EuiHvpFiyGYPr7KkbZ1/Hkhbd5MVjH0ix5nt1EfoO4n1u8mI6FwAEzZrvMcgDbMy8OiGwh+u8vLDme1Wl90410RGcV/Pqdq23uN4FAKyF0BcAABRaNlAxmR0MVGAj5tXt0k06h5u8OPFX0vms+V4k6R++6yiQ69zkxbHvIgDAJ2u+l4jOPWBQbWXLQCsNgYMM1az5XkXpPVVN3Ff5Niup6SYvDrIrHQCweYS+AACgUOwpunmxIfNavqdVIqnlri/OIJ49Reg7oOvd9QyMAQibPfVeLLa0ALaq0wXcdNfna1LguNhT71UkTSsNgLnfGo8lSTOSZop0zwIAyBdCXwAAkHv2FMuOYUUrdewWKthdS/a8P+a7jgI54q6/uO67CADwidB3MO76iy07304ovdasZEdVBF1IdfcCDnByWTbhdjo7eE2MzpykWlnuYwAA/hD6AgCAXLInT3eWbI7EMoUh691jtxPwttwNlwQxIGJPnuZifePuczdcMu27CADwyZ48HYvQdxAXuhsuSVb7Q3vydKQ0EK5mx4T4/YZsSb3LQK/x3Ckbe/J0J/w97LuWklmSNO1uuKThuxAAQDkQ+gIAgFywJ09X1F2y+YDXYuBD73LMsaRFd8MlLY/15AKh70Dm3Q2XRL6LAACf7MnTdRHKDOI6d8Ml8aB/KbturSgNgns/MlExLAvqLAMdyHWrPXm6KqkhVl8ahiVJUSjPHQDAeFzguwAAABAue+I0yzaHpa1sCeaejy33yTC6djfFaUG8Njaq4rsAAPCOqUKDipRONhtI1uGZrPR37YnTkZYvE10R5/Ky2pUdh+2J021lXcDuk5eUdhnoLKCs2hOnG5IOei6n6CL3SQJfAMBwEfoCAICxygbCOks30w1RTp1wN84+Ju6Tg3fRQFK6pDU2hvcTAMCgKsP+gatd82STHStiqeiy2q40BD1oT5zuXQa6WcYJju6Tl9TsidMSwe9mHSLwBQCMAss7AwCAkbK/vDuh7rLNk5K2eS0Iw3R+uPupS2N/5ZSP/eXdhhhMG8R1PAcBhMz+8m4k6R++6yiQefepSyOfBdhf3q0oDYMjdTuECYPLZV6dAPhTlyaeaxkqrlU3xfv7DgCgvOj0BQAAQ5cFvZ2Ql/15i49w15/EdwEFU/FdAACgULyHq1kImKhvqWj7y7v9ncEVsUx0Ue3PjnvtL+929wH+1KWF7/R0n7q0Zn95tyW26xlEzXcBAIDyotMXAAAMhT3+bkXdoNf7ABo2bV79e+7eeGnplqQrCnv83Zqko77rKJAj7sZL676LAABfsuuxs77rKJjd7sbihG/2+Lu9IXCUfWSLg2JqKw2AG0V6Dq4me27WsoPVnVY26268tOa7CABAeRH6AgCATesJemtiZnfRLKgb7MaSEndjuZabKwN7nGU6BzTvbmS5PABhs8ffZaBnMNe7Gy9t+i5iK+zxdye0vCO4KiZhFk0nAI6L/nyUJHv83c49Iqs+LXch91wAgFEi9AUAAAOxP79TVbejl6A3/5aUdexmR+Juuiz2WRA2zv78TkV0bA2i7W66rOK7CADwyf78zqLoshvEEXfTZXXfRYxCdh1R7TvoCs6/JXWWgL7pskIHwNlzcFLStHjuLbibLqv6LgIAUG6EvgAAYF1Z0FtTesMe+s16nrXVDXdjpQFv4rMgbJ39+R0u2AfzPnfTZSxJDiBY9ud3YtHlOYh5d9Nlke8ixsn+/E6k5Z3BPF/yq0wBcFVp+DupMCemHHI3XTbjuwgAQLkR+gIAgBXZnwh6c25BPR287tOXxV6rwcjYn95pia76QVzH6wFAyOxPhL4DWnKfvmzCdxG+Zdf+/UeIwVyedQPgTxc3ALY/vTOhbvdvSNe4F7pPMyEXADBahL4AAOAcgt7cmtfygLfluR6Mkf3pnabYD20Qh9yn6aIAEC770zt1SYd911EwhDErsD8tWx46EkFwnpQlAK4oDX9rKvdzq+0+zRYkAIDRu8B3AQAAwC/749sEvfmyPOD9zOUEvKFzriVC30GwVxqAsDnHEveDiyQ1PNeQO1kQnigNFyVJ9se3K2Kf4DzYJumgpIP2x7e7AfBnLi9UAJw9x6YlTdsf364pvS8t40oF3NMBAMaC0BcAgABlgzWTSm+qQ1pSK28IeLERie8CCobQF0DouJ4YHOeODXKfuTzR+UHwhLrdwJHoCB63cgTAn7m8IamR3auWrfuX92UAwFiwvDMAAIGwxwh6PVse8N5MwIuNscfejiT9w3cdBfM+d/PldLoBCFJ2zXfWdx0Fs+Buvpzgd4iy5yFLQ/vVVhoAN4p672GPlab79zp38+Wx7yIAAOVH6AsAQInZY29PqBv0Fv1GuUgWtDzgjf2Wg6Kzx97mon0wDKwBCBrnjU1hwtCI9QTBUfaR+5Px6QTAM+7myxO/pQwue+4Uuft3d1GDdwBAsRD6AgBQQvbYqZrSsJd9QEevrW7AG7ub3x/7LQdlZI+daokO/UEccTe/v+67CADwhfPGplzHddz42WOn+ruBed6O3oLSPayb7ub3J35LGVx2rzutAj1X3M3vN981AADCQOgLAEBJ2KOnJpUGvZMq5uznopiXFKvTxfvZ4g2UoHjs0VNNMYljEPPus++PfBcBAL7Yo6di0UU5qCPus0wYygN79FSkbghclbTdZz0lN69OAPzZ9xeq090ePVVVGv4e9F3LetxnCX0BAONB6AsAQIFlN7o1pUEvgyHD11Y34I3dZ9/Pklzwwh49VZd02HcdRcLgGoCQcd7YFCYM5ZQ9eqoiloUehzlJDffZ9zd9FzIIe/TUhNJ74mnl856Y9xYAwNgQ+gIAUDD2yKmKuvv0FmZJq4JoK53pnoa8nyvWbHeUlz1yKpL0D991FMxu9zkmagAIkz1yqibpqO86Cuh9XP8VQ3Zt1BsE5zHsK6oldfb/Ldi1lD1yqnOfnKcVcubd5wh9AQDjQegLAEAB2CNvTai7dHOebmDL5oj73BV130UA/bL3gP/zXUfBHHKfu2LGdxEA4IM98lZV0jHfdRTQ9e5zVxSqyxEpe+StirohcCQmxw5LW9KMpKb73BWJ51o2LHs+TCsNgH1vfTTvPndF5LkGAEAgCH0BAMgxe/itSN3lm33frIbgiPs8oS/yyR5+KxFdLIOYc5+/YtJ3EQDgiz38FgM+g7vPff6Kad9FYDiye6nOURX3U1vV3f/381cUoiPeHj43ebouf9fR8+7zhL4AgPG4wHcBAABgOXv4rYrSoLcmAh4AXS3xnjAIVkUAELoF0e04qMh3ARge9/krYklx52t7+K3e5aAjcV01qP3ZMWMPv9WU1Mh+x7mVhdMNSY1sEsC0xn+NmIz53wMABIzQFwCAHLA/vNmZgVxTeiMNAMs51xJB5kDsD29G7gtXxr7rAAAv0vMGoe9gdtkf3qy4L1yZ+C4Ew+c+f0VL6SQ6SZL94c2KlofAvF42Zpukg5IO2h/ebCsLVfP+uulMAsj+v9c1vtW0kjH8GwAASCL0BQDAK/vDm1Wls41ZvhnAemJJh30XUTCT6unwAYDAtJQGMxhMpDTEQsllIWWj83U2ETcS+wIPYrvS69PD9oc35yQ13ReubPgtaW3Z//da9v+7pvR+nK5vAEApEPoCADBm9hA3lwAG575wZWwPvem7jKKJfBcAAN64bkcjBjIpQt8guS9cuSipmR2d+7ZOF3AkVmRazwFJB+yhN2eU/g5n3BevzO37UPb/e0bSjD30Zk2sugUAKAFzzvmuAQCAINhDb04qHUSi4yK/jrgvXln3XQSwGnvoTZbqHNyF7ov5Xm4QAEbFHnqTQZ/BLbkvXjnhuwjkkz30ZiRC4EEsKA1Wm+6LVy76LmY92f/fmoZ7z849JgBgbOj0BQBghGz2ZEXpTWNNdPUC2CrnYhH6DioSHVsAQuXcgjhvDGqbzZ6cdAevavouBPnjvnhlrJ6tI2z2ZCRC4LXsknRU0ozNnmxKariDV8V+S1pd5/+vzZ6sa7z7/gIAMBSEvgAAjIDNnpxUGvQe8FwKgHKJJd3uu4iCYZlOACFjhYjNiZQt8QusJQsw487XhMCr2qa0e/agzZ5sK+3+bbiDV+Wy+9cdvCqRVLPZkxNKt2WaFuEvAKAACH0BABgSa9DVC2DEXHdQERvG5BsA4UrPG2wtMrhJpSEPMJDeENgaJyfUDYAjMQGjY7ukeyXda42Ts5IarpbP7t8slK5LqlvjZC37nHt9AEBusacvAABbZA26ekvkiKtdVfddBLAWa5yka2tw17say3QCCI81TlYlHfNdR0HtdrWrWr6LQHn0hcCTIjzs1e3+reWz+7cjC39r2ngnN/eYAICxIfQFAGAT7OiJzjJPNXGzXiZH3NSOuu8igLXY0RMzYonnQc26qR0130UAgA929MSiWJZ0M+5zUzvo9sXI2NETFS0PgXmdSktKl1afcVM7cj3pwo6eiJR2/q4X/l7npnbEo64HAABJ+n++CwAAoEjs6InIjp5oSPo/SYdF4Atg/GLfBRTQpO8CAMCj2HcBBcW5AyPlpnYkbmpHw03tqLmpHROSdks6JGnOc2k+dfb+PWZHT7Ts6Ima53pW5aZ2xG5qR6T0/9us53IAAJBEpy8AAOuyB09MKB30HAdMzwAAIABJREFUqYuQt+yOuFvo9EX+2YMnuIgf3PXulh0s8QwgOPbgiWml+2dicLvdLfnuNkR52YMnIqX3oZHC3tpjSVJD0oy7ZUfit5TV2YMnKkrHDPr3Ub/O3UKnLwBgPOj0BQBgFfbgiYo9eKIhKZF0VAS+APJj3ncBBUTHFoBQxb4LKLCa7wIQLnfLjtjdsmPa3bKjKul9kqaUdpS2/VY2dtuUbm1y1h480bQHT+Tyms7dsiNxt+yoSbpQ6f+nJb8VAQBCRKcvAAB97PdvTCrdr3e9vXlQPkfcrTvrvosA1mO/f4OurcEtuVt3TvguAgB8sN+/wb6+m9N2t+6s+C4C6Ge/f6Oq7l7AId63tiXNSGq4W3cu+i5mJfb7NyaUjis03a07WTEAADAWhL4AAOjcDVlN6U1ZSB29S5IWFdZ/81oIfVEI2UDfMd91FNCUu3Vnw3cRADBu9vs3mpIO+K6joK5zt+6MfRcBrCa7l43UDYFDurdbktSUVHe37kw81wIAgHcs7wwACJo98EbFHnijIadETvfKabucVPJjQU73yek6d+vOCTk1clBTfg6gANytO1tyant/vRTvyOVygAAwck7NHLwHF/WobeI3DoyNu3Xnort1Z9PdunPa3bqzIqcL5XRITnM5eP2M+tgmp4NyOmsPvBHbA29wrQcACNoFvgsAAMCH7GYwlCWcl5Tu5daUFLsvMQMaKImm0v3NsHEH7IE3JtyX8rkMIACMUOy7gAKb5NyBIsnu92ayo3PvO6m0E3i7t8JGb7+k/fbAG92ln3ndAgACQ+gLAAiG/e74hNKb3brKfbMrpXscpSHvl69urvlItnoAism5WIS+m1FTNggKAKFwX9qZ2O+OL0ja5buWAtqm9B6i4bkOYFPcl3Y2ld4byn53PIS9gLdLuldS3X53vCFpxn356sRrRQAAjAmhLwCg9Ox3xyvq7te7zWsxozWv9Ga+yU0tUH7uy1c37XfHl1Tu97VRmBahL4AwxSL03ayaCH1RAu7LV7cktSTN9EyKjrKPZbum3KZ0guTt9rvjc0rD39hvSQAAjBahLwCgtOz+41Wlg/sHfdcyIkvKunklNd1tV29u6SoafYHicmqqvO9xo7Ld7j9edbdd3fJdCACMlWNbgC3Yb/cfr7jbmFiJ8nBfvnpR6WSGhiTZ/ccjpeHvpMq3MtYBSQfs/uMLkmbcbVc3PNcDAPj/7N3pdhvXme7xZ9NObGcinXQ6ne5eS9ANHEKOY2uwRPAKRF+BoC8nSXcSQekkkkhKBCVRQ5xEUOb0F0FXYOoKWNDg2RbYN2BwrdOd9JCEzDw19/lQBRGiOQBEVe3aVf/fWntpooAXQ9Ue3j0gESR9AQC5Y/713/J8Xm932+ZF+3+ZpQyApO8e1RSu2gKAwrD/9/8E5l/ZIWIItagAuRT1LwNJNfOv/1bSRgI4T/3qcUm3zL/+W13dc3/3OnkaAIAMMpZz/AAAOWF+ulxVPs/rXVY4+3rRfmG8E/eDm58u1yXNxf24npq3Xxivuw4CGIT56fKqGMDfi2ftF8YZ5ANQKOany00xWWiv1uwXxsdcBwGkzfx0ubsNdHcr6Dy1O9fUTf4m0NcGACBtrPQFAHgt6oB2Z93nqfN5R90VvSQlAOyM1b57UxVn+wIoHuqMvRs1P12u2i+MN10HAqQp6o821d0G+qfLvQlg3ydcjyqcAD1nfrp8W1Kd5C8AwGckfQEAXjI/WS5pY3vOPCR7u+fzLkoK7BdTTPSy6QfgN8713auaSPoCKBj7hfFF85Nltnjeu6qixBdQVPYL491+q8xPlssKr4s8nAN8QtIJ85PllqS6/eJ44DgeAAAGxvbOAACvmJ+0Swq3cM5DgmNF4ZlJi/aL5UVXQZiftOtie+euefvFct11EMCgzE/abPG8Ny+7vP8CgAvmJ+2m8tGWduWA/WK57ToIIGvMT9plhat/qwrPzvVdS1LTfrHcdB0IAAD9YqUvAMAL5sftisJVWccdhzKsFYWzopv2SxkZLGL+F+A/q6akU67D8FBN0UoVACgMdogYVne3IQA9oskQbUkN8+N2HnqZE5ImzI/bdUl1+yWSvwCA7BtxHQAAADsxP25XzI/bgaQl+ZvwXZF0U9IB+6VyyX6pXMtMwhdAXjRdB+CpCfPjdtl1EACQJvul8qLCo0WwNyfMj9sl10EASM0+SbfMj9sd8+N21fy4PeY6IAAAtsNKXwBAJpkftasKZ9BPuI1kz5YVJmEC+08ZT/DmYQ42UHD2S+W2+VF7WfnYSi9trNgCUDys9h1WVeGRMwC2ks8+5j5JtyQ1zI/aDUkN+0/lVccxAQDwGJK+AIBMMT96WFU4gLLPbSR70k30Ltp/OtBxG8og8tkjB4rHNiXdcB2Fh06YHz2s+3XfBoBhWZK+w6mZHz1s2H86QMIH2FKu+5ijkuYU3QckcS8AAGQGSV8AQCaYH3qb7N1I9P6zpwmDXPfHB1ZxHQCwZ+G5viR996YuVvsCKBD7TwcWzQ8frsi/tndWjCqsNxqO4wCyqRh9zI3k7w+j5O8/k/wFALjFmb4AAKfMDx9WzQ8fdhRuk+TLoNOKpNOS9tt/PlC2/3yg4W3CF0BuRINMt13H4akT5ocPOZ8NQNEsug7AczXXAQDIhG7y91fmhw+b5ocPS47jAQAUGCt9AQBOmB94t7J3ReHAWNN++UC2z+gdVDFmYQPFEK72ZbvOvamJ8xkBFIlVQ9Ip12F4bJ/5wcOq/fKBputAgMwpbh/zhKQT5gcPb0uq2y8zORwAkC5jbXFrYQBA+swP3qvKn2RvT6L3uXwlenuYH7xXVzgzGVLLfvm5iusggGGYH7zXkR/32KxZk1SyX36ObfkAFIb5wXttSeOu4/DYiv3ycyXXQQBZY37wHgPOoSj5+1zHdSAAgGJgpS8AIBXm+94ke9fUTfR+5bnAcSzpoDsO5Eu4couzfQc3Klb7AiiasM645ToMj+0z33+var/yXNN1IECm0MfsClf+fv+9MPn7FZK/AIBkcaYvACBR5vvvVc333+so22f2rimcgfuy/cpzY/Yrz1ULk/AFkEdNhfc1DK5mvv9eyXUQAJCiRVFnDKvuOgAAmXdC0vvm++81aWsCAJJE0hcAkAjzvfeq5nvvdWR1S1b7ZKUMljuyOimrUpToXUz0Tckq959DtgrgOfuV51Zltej8WvKzjMoyeA+gOKgzYin7zPfeqw7+7gM55v66zGo5Iav3zffea5jvvTc2zFsMAMBW2N4ZABAr8713q8r2Ns7LClfBNe1XP8e5jZLC3ieAfLF1hSsKMLgT5nvv1u1XP9dxHQgApIM6IwZ1hX0MAJLoY+7qlKSq+d67DUkNxiYAAHFhpS8AIBbm5rtVc/PdjrK5sndFVjdltd9+9XNl+9XP0anq5f7zyVYBcsB+9XMdhbsZuL+m/Cz1PbztAOClqM5oZeDe63PZZ26+Wx/83Qdyyv016UMZldWcrDrm5rt1c/NdVv4CAIZG0hcAMBRz892KufluoOyd2ds9p3fSnvpcyZ76XM2eYtUWgEJpuA7AYyfMzXcrroMAgBRRZwyvRtIGwB6MSpqTSP4CAIZH0hcAsCc9yd4lSROOw+l1R9JJSSV76nNVe+pzgeN4AMCJ6P7Xch2Hx+quAwCAtNhTn1uUtOI6Ds+NSqq5DgKAt7rJ37a5+W7VcSwAAE9xpi8AYCCm8U5J4UqA445D6bWiMKZFW3u+4zgW/1jrOgIASbG2rnByDgY3YRrvVG3t+abrQAAgFWGdcct1GJ6rmcY7TfokKDz6mMPYJ+mWabxTl1SnLQoAGAQrfQEAfTGNd0qm8U5T0vvKRsK3u33zAVt7vmRrzzcYXAGAx9na84GkZddxeKxuGu+wxR6AolhU2MbG3o2KnSIAxKOb/A1M452K62AAAH4g6QsA2JG58c6YufFOXVbvy+qErOS4tGR1UlYlW3u+amvPt5N/F3LO/WearQLkjVXD+XXlb9kny1adAIrB1p5fpc6IpZwwN0jQoODcX4d5KhOyWjI33gnMjXfKA34SAICCIekLANiWufFOXVJH4bkyLq1Iuilpvz39fMWefr5pTz+/6jgmAPCCPf18U5zTOIw5c+OdkusgACAlDbHaNw4N1wEAyJ0JSQ/NjXeatE0BANvhTF8AwAeY775dVbgt2T63keiOpKb92ucXHceRb5y3BOQf5zQOqymp4jgGAEicPf38qvnu2w25n/Tpu3Hz3ber9mufb7oOBHCCPmaSTkg6Yb779rykhv3a55kQDwB4hJW+AIBHzHffrpjvvh0oTAy4SviuSDotab/92uenSPgCwPCiQeeW6zg8NmG++/aU6yAAICWs9o1Hw3z3bc6FB5CUOUkd8923OYoEAPAIK30BADLfebukcHDnuMMwbktq2n/5fOAwhmJiEjZQDFZ1SUuuw/BY03zn7ZL9F1ZTAMg3+7XPr5rvsNo3BqMK+1hVx3EA6aOPmZZRSTfMd96uSarZf2HSPAAUHSt9AaDAzHfeGjPfeash2fclezzsmaVaViR7WrLP2n/5fJWEryupf+4ZL0A+hfdY23J/jXlbRiXbHPydBwAf2YZk1zJw7/W9nDDfeasy8NsPeM/5tVe0sk+yr5rvvBWY77xV7u8zAgDkESt9AaCgzLffqik8t3fUwdOHq3q//kLg4LmxmXUdAIDUsNp3WMfNt9+qUH8ByDv7Ly+smm+/xWrfeDQllRzHAKSLPqYrE5Iemm+/dVtS3X79hY7jeAAAKWOlLwAUjPn2WxXz7bc6km4o3YTviqR5Sfvt11+oMmAOAOmL7r13XMfhuab59luc0QigCDjbNx77zLffqrsOAoAzJyW1Un7OE5La3HsAoHhI+gJAQZhX3iqZV94KZLUkq30p7jTUktXL9usvlOzXX2CmaRY534kqYwXIO6ua8+vM77JPVo09vPMA4BX79RdWZdXIwH03D2XOvMKWqygQ99dcZor9+gtN+/UXKrLaL6vbslpL6blHo3tPx7zy1lSfnxwAwHMkfQEg58wrb46ZV97snts7kVLPZk2yNyW7337jhYr9xguLqb1g7EEGesLZKazeQ+7Zb7zQkex8Bq43n8sJ88qbDJ4BnjCvvFk2r7xZch2Hj+w3XqhLdiUD9908lOaAbz/gMefXW4ZK9I5844WO/cYLVcmWJHtS6d1b90n2VfPKm4F55U0mnwBAzhlr7e4/BQDwkvnWm1WF27KltY3zcvR8i/abL66m9JwYkvnWm3VxXtsj9psvGtcxAEkz33pzTFJHbs51z4s1SSXqOyCbovtcQ+EWl10rkur2my82nQTlqahPcct1HDkxb7/5Yt11EEDSzLfeZMA5slP/0nzrzYqkqh6vq5J2U2FdSBsWAHKIlb4AkEPmW29WzLfeDBQOzqQxoH9b0qT95otl+80Xm3QeACDbovt0zXUcnhuVxE4WQAZFCd9AHxxE3yfpVjThDX2KkuRpn0eZV3PmW6y0AxCy33wxsN98sSppv6R5pXOO+ilJnWhCDwAgZ1jpCwA5Yq5vuaIhKWvRczXtmRc7KTwfEmKuv7ko6bjrOLLCnmGlL4rDXH8zkDThOg7PnbZnXuSMXyBDzPW+djGZtGdeDJKPJh/M9TcrkpZcx5ETy5Iq9gwTZZFf5jorfbsG7V+a629WFU7OHE8koMctS6pRHwJAfrDSFwBywlx/oybZjmRPJHwezLJkT9ozL47ZMy/WSfjmgR1zf85RlgpQJLbm/przvtww199g1RaQKX3d2+rOwvNQmBCwtzNwz81DGef7h/xzfp1lqAz4zp15sWnPvFiW7KSSv++OS3bJXH+jaa6/MTZwsACAzCHpCwCeM9feKJtrb7RldUNWown2B+7IatKeOVi2Zw42U3yJSJrrPnDWClAg9szBtqxuOr/u/C+L5hoDZUAWmGtvVNRfm3jCXGPCxkCsarJay8A9Nw/llLn2xtTAnwHgC/fXWHbKXt/CMwcDe+ZgVVb7FbbXk7z/npBVx1x7g+NfAMBzJH0BwFPm2htj5tobDUkPldy2P2uSbkrab88enLJnDwYJPQ8AwJ26pBXXQXhun6Sm6yAASJIqA/wsSbcB2LMHVxXWGYhH01x7o+Q6CADZZs8e7NizB2uSSpJOKrl2+6ikG+baGwGTogDAXyR9AcBD5uobVVl1ZHUqoVmeK7I6LauSPXuwZs8e7KT5+pAy1zOfs1aAgrFnD64qXL3l/vrzuxw3V1kdAThnVRnguq04itJb9uzBhqyWM3DPzUMZldXiwB8C4AP311d2Skzs2YOr9uzBpj17sCSrl2XVSijmCVk9NFffaJir7GQDAL4h6QsAHjFXXy+Zq68Hkr0l2dEEWvfheb3nDpbsuYMNe+7gaqovEI647gVnrQDFY88dXJTsHffXn/flhrn6emXgDwBAjGyZej9pnAcfYxk3V19vDPoJANnn/NrKUImfPXdw0Z47WJHsASV37u8pybbN1dfZFQMAPELSFwA8Ya68XpfV+wpnXcbdng/P6z13qGzPHWqm+sLgnus+cNYKUFRWVXFWYxxl0Vx5vTTw+w9gaObK62Pq7zxf6v0h2HOHAnEefJzllLlCUgU54/66yk5JkD13qG3PHaoquXN/98nqVXPl9YD2LQD4gaQvAGScufJ6xVx5vSNpLoGHvy1pv50+NGWnDwUJPD4AwBN2+tCqpKrrOHJgVNKiufI62+EB6eMMwvTUxXnwcWqaK6/z/QWwJ3b6UMdOH+qe+zuv+O/PE5La5srrHGUCABlH0hcAMsosvD5mFl5vyGopml0Z10zNNVnNy2q/nT5UtdOHOim/NGSN65nPWStAgdnpQ4sKd39wfy36XcZlxXadQNoGO8+Xen8IdvrQqsIdIlzfb/NSRmXVNAtMGEJOuL+mslNSZKcPrdrpQ3U7fagkq5OyWon5PnXDLLzeNgtMUgGArCLpCwAZZBZem5JsR+EZKoqprEh2XrIlO3OobmdI9qLLdS84awUoOluV7Jr7a9H7csIsvFYf9N0HMIxBz/Ol3h+GnTkUSPZmBu63eSnjkm0O9ikAWeX8espQccPOHGramUMlyb4s2VbM96qHZuG1ull4jYkqAJAxJH0BIEPM5dfGzOXXFmX1qgY9j2z7siKrk3bmcMnOHK7bmcOrqb8wZJvrPnDGirn8WmW4NxTwm505zOqt+MqcufxaddDPAMAeDb7St+0o0vywqivelWRFL8fNZSYMIQfcX0vZKY7ZmcOLduZwRVaTsmrF+NrmZNWm/wwA2ULSFwAyIhoU7kg6HtNDLks6aWcPl+zs4WZMjwkAKAA7e3hR0k3XceTELQbDgORF19nogP+NyZBDsrOHOQ8+fkwYAhA7O3s4sLOHK5L2S7od08Puk7RkLr/WMJdZ9QsAWUDSFwAcM5deK5lLrwWyuqV4Vve2ZDVpZw+XSfaiL65nPmexAJDC1VvLzq/HfJRFc+k1zj4DkmQ1tYdrk6RvDOzs4UBWNzNwr81TuUW9Aa+5v4ayUzLGzh7u2NnDVVntl9XtmF7nKVm1zSUmOgKAayR9AcAhc+lBTbJtyU7E0MpuSXbSnj9csecPB6m/GHjMdS84iwWAPX94VZzvG1cZlWxgLj0oDfo5AOiXndrDtcn2zjGx5w/XJLucgfttnkpgLj0g8QtPOb9+MlSyyZ4/3LHnD1clu1+yt2N4rfsku2QuPWiaSw9Y9QsAjpD0BQAHzMUHJXPxQSCrGxp+dW+4svf8kYo9fyRI/9XAe677wFksACRJ9vyRtqxqzq/JfJRRWS2aiwyCAXEzFx9UZLWPOt+x8Dz4tQzcb/NSRmXVpN6Al9xfP9kpGWfPH+nY80eqsnpWVvMa/j5+QlYdc/HBlIOXAwCFR9IXAFJmLj6oSWpLmhjyoVqSJu2FIxV7gWQvACAZ9sKRpuI796voxiUFDOADsavu5T/Rho6XvXCkLanmOo6cod4AkAp74ciqvXCkLqkkaV7S2hAPNyrpVXPxQYP7FwCki6QvAKTEzD8YM/OxrO69Lav9JHsRG6uy89nPWSsAHheu9uV833jKuKwCM88AGBAHM/9gTHs7zxcJsBeONBXfGZGUjXpjccCPAnDL/XWTneKZR8lfq5KGX/kbnvU7/6Di4KUAQCGR9AWAFJj5+1OS7Wi4s3tvS3a/nTtStXNHOum/CuSXHXXfE85aAdDLzh3hfN94y7hkAzN/n8QvMDQ7pb21ZVpu4i0Cy/m+8ZcJM3+/OdjnALjk/JrJUPGTnTuyaueO1CVbkuy89t4P2CfZJTN/v0HbFwCSR9IXABJk6vfHTP3+oqxe1d5X97Zktd/OvVS1cy91XLwO5JzrPnD2Ch1RYAt27qW2wvMaXV+jeSnhit86g1/AUKzqe74OkQg799KqON83iXLC1En8whPur5fsFM/ZuZdW7dxLdQ2/8jdc9Vu/X3byQgCgIEj6AkBCTP1+RVJH0vE9PkR4Zm/9pYqtk+wFUkQnFNiGrb+0qPCML8QjPKuRxC+wJ6Z+f0rSvj3+9yDGULCJrb/U1h7PWsaOSPwCcMLWX1q19ZfqGu7M332SHpr6/XpsgQEAHkPSFwBiZubujZm5ew1ZuyRrR2WtBiwtWdtN9gauXw8KYPDvaP4LgG3Z+kt1WXvb+XWanzIuawMzd4/ELzAoa2tDXHurrsPPO1t/aVHWzmfgPpu3csLM3Wu6/nyBHbm/TrJTcuZR8tfakqy9ucf3Zc7M3WubuXtMuAaAmJH0BYAYRQ3WQNKpPfz3cGXv/NGKnT8axBkXAAAxq0ladh1EjoQrfkn8An0zc/cqkiaGeIh2TKFgB3b+aF3SHddx5BCJXwBO2fmjq3b+aE3Sfkm39/AQ3fZvLd7IAKDYSPoCQEzMhXs1WT1UeEafBijLsiR74dBg39diFAA7svNHV2VVGeJML8oHS3jG7wUSv0BfhjnLNyys9E1LeL7vcgbus3krJ8wFEr/IKPfXR3ZKztn5ox07f7Qqq/2yuj3g+zMqqxvmwr1F2sAAEA+SvgAwJHPh3pi5cC+QdGPA/7oi6aS9eLRsL5LsBQD4xV48uiqpor2d54WthSseGPQCdmQuDL3KV/biUVb6poT6IlEkfgFkgr14tGMvHq0qXPnbGvC/H5fUiep3AMAQSPoCwBDM+btTsrYjaycGOLtkTdaetBePluzFo03XrwFwfsZRFguAvtiLR9uytur8ms1XGZe1HXP+LmecAduxtj7kdbbi+iUUjb14dFXWVhT2hVzfZ/NWTpjzd5uuP2PgMe6vi+yUgomSvxVZOylrWwO8V6Oydsmcv9tw/RoAwGckfQFgj6KG6KuSRvv8L2uS5iWV7KVjzaTiAgZhzt9lNdkH8Z4AA7CXji1KOuk6jpwZlRSQ+AU+yJy/O6UhV/lK6sQQCgZkLx1rS6q6jiOnTpjzdxdp2wPICnvpWGAvHatImlS4012/Tpnzd9vm/N1SIoEBQM6R9AWAAZnZu2Uze7ctq1MDnFNyU1Yle+lY3V46xvlhyA6rsvMzjrJXSLIAA7KXjjVlNZ+B6zdPZVRWD83s3epgnwaQc1aNGK4vtnZ2xF46tiirkxm4x+axHJdVYGZJ/CID3F8P2SkFFyV/Swrv/St9vm/jsmrTDgaAwZH0BYABRA3OQOGZe/24LWm/vXysZi+T7AUA5Je9fKyusN5DvG6Z2bs110EAWWBm79Yl7YvhoWiXO2QvH2sq3AEJ8QvPhp9lhRyAbInu/WWF9/9+zngfVdgObjKZBQD6Z2wBzxYAgEGZmdaYpIakE33+l5akul2YCBILCoiBmWlVJC25jiNjWnZhouI6CMBXZqbVVP/1Jfp32y5MVF0HAbhiZlolSW31f7TKTiZpp7tHfZGoNUkVuzDBqnY4YWZaDDhH7MKEcR1D1kRjbHVJp/r8L8uSqtzTAGB3rPQFgF2YmVZZ4erefgYkViS9bBcmKgwkAQCKKEpMsuI3fifMTKsdDZIBRdRQPAlfiZW+mUB9kajwbPiZ1pTrQABgM7swsWoXJmqS9ku608d/CXcxmGlVEw0MAHKApC8A7CBqUAbafTvnNUmn7cJEyS5MLCYdFwAAWRYN5C+7jiOHxiV1oglpQGFEiavjcT0eK4Wyg8RvokYlvWpmWhwRACCT7MJExy5MTEma1O59h3C755lWk0mQALA9kr4AsA0z3WrI6pasRmWlHcpNWZXswkTDYbjA3uz83S5qKQ3zlgKIWFVktZyBazpvZVRWD800Kx1QDGa6NSarZozX0ErarwE7swsTVVm1MnB/zWu5YaZbzQE+EmB47r/32SnYlV2YCOzCRFlWJ2W1tst7ekJWgZlulZwFDAAZRtIXADYx00HJTAdtyZ7apfXekux+e2WiZq9MsEUcPGXL7nvBmSv7hntPAUhSWDfaimSXM3Bd57HcMtNB00wHrHRAztmmZEdjvHY66caP/tgp6otEywkzHbSpM5Ae59/5DBX0y16ZaEq2JNn5Xd7Xccm2zXTAFvYAsAlJXwDoYc4FFVm1ZTW+Q/tyRVaT9kqlYq9UOg7DBYZnNea8D5zFAiAW9kplVaz4TbKEKx3OBaVBPhfAF+ZcMCWr4zFfN2ztnEHUF6mUcVl1zLmgMsBHA+yN++97dgoGYq9UVu2VSl1W+2V1Z4f3dlRWr5pzQd1huACQOSR9ASASNRSXFJ4TspU1SfP2aqVkr1aCtOICAMBn9mplVVJFnPGblHFJbXMuqLoOBIhTNJmhmcBDdxJ4TMSA+iIVo5KWzLmAc34BZJq9WunYq5V+zvudM+eCwJxjJwMAkEj6AoDM2WDMnA0WZTW3wwzC27Iq2auVusNQgfi5nvWc1QIgVvbqoxVct51f3/kso7K6Zc4GTXOWAS/khNVi9N2O+3phpW+G2auVVXu1Uqa+SLzcMGeDReoMJMb9dzw7BUOxVytBVC+c1vbn/U7Uu9W0AAAgAElEQVTIqm3OBmWnwQJABpD0BVBo5uxSWbKBZI9v00JfluykvVap2msVzu1FDrnuAWezhPcGAHGy1yqr9lqlKtnbrq/xHJcTkm1zD4PvzNmlhsLz+pRAIenrAeqLVMrxqM6o9P3BAH1z/v3OUEEc7LVKQ+F5v9vVDfskG5izS1WHYQKAcyR9ARSWObM0JatAW5/fuyar0/baZNlemwycBgokyarkvA+czcKqByAh9tpkVazgSrLsk9VDc2apPsDHAmSGObNUldWppK4Re22SiZyeoL5IpeyT1RJ1BmLn/rudnYLY2GuTq1HdMKmtz4APd785s9RwGykAuEPSF0AhmTNLNUmvauvze29LKtnrkzQSUQQl1wEAKB57fbIq6abrOHJuzpxZapszrPqFP6Lva5Jt8FaCj40EUF+kpltnlFwHAgC7sdcnA3t9sizptKS1LX7klDmzFJgzS0zmBlA4JH0BFMrImaWxkTNLTSPdMJI2lWUjTdrrk1V7nRUAKIYtrgNKVAAky16frBnppOtrPedl3EgPR1jBBQ+MnFkqGSkw0miC10QnxZeEmFBfpFpntEfCCdLAUDLwfc5MQXLs9cmGkUpGur3Fez8R3dOYAAmgUEj6AiiMkbNLYzIKZHRiU0twTUan169Pltevs5UzCsZ1Dzi7hY4hkIL165NNGZ2M6mLX132ey9zI2aX2CGf9IqOidvqijEYTvhY66b0qxIn6IrUyKqMbI2eXgpGzrPrFENx/l7NTkKj165Or69cnqzKalNHKpvd/n4yCkbNLU47DBIDUkPQFUAhPnF0qG6ljwtnLvW3AO0Yqr19jK2cUk5HGXPeBM1rYBgpIyfq1yaaRKkZay8C1n+cybqSHT5xdajxxlq3ukB1PnF0aM+EK383t9CRKkNoLQ+yoL1ItE0ZqP3GWVb/Ymwx8hzNTkI71a5PB+rXJkpHmzeP1xKiRXuV+BqAoSPoCyL0nzgZVyQSSGe1peq9I5uX/vTY59b/XJjtOAwScMuPuu8FZLQDS8r/XJtuSqUhm2f21n/tySjLtJ84GrHiAc0+cDcYUttPTao90UnppSEhUX5SpL1Ipo5K58cTZIHjibMBOERiQ8+9vhgrS9L/XJusK64nWps/ixhNng6bT4AAgBcZa6zoGAEjMk+eCuqS5TX99U1L9r1crnNuLwnvyXEBDYGvzf71aqbsOAiiaJ88FY5IWJU24jqUgWpKqf71a6bgOBMUTXe+BpPG0nvOvVyuMvucE9YUT85Ia9KPRD/qZG6h73HnyXFCV1JA02vPXy5Iq3MsA5BUrfQHk1pPngqYeT/guS5r869VKjcYdgF1UXAcAFNFfr1ZW/3q1UpF023UsBTEh6f0nzwWNKIECpMJFwlfhJAfkRE99cdN1LAUyJ6n95Dl2igDgh79erTQllSTd6fnrcUnBk+fYwQBAPrHSF0DufGjrQaT5v7BqD3jMh8JOzkPXcWRU6y/hQCIARz4Uzsy/5TqOAlmTVP/L1UrDdSDItw+dC0oKV2immfCVpNt/uVqppvycSMGHtl7JhWS1JNX+crXSdh0IsulDrPR95C+s9M2ED50LKpKakvZFf7UmqcJ9DEDesNIXQK5Eg0iBNgaRliUdIOELbIlVXQAy6y/hzPwDCgdkkLxRSTc+dC7oRAkUIHbRhLO20k/4Knpe5FBUX1QkrbiNpFAmJD380Lmg+SF2igDggb9crQSSytrYIWJU4X2s6iomAEgCK30B5MaHp4OywoTvqKLVKn++wmoVYDsfng4qkpZcx5FVf77CjGwgCz48zbmNjixLqv35SiVwHQjy4cPTzldjTvJ9zjfqC2fWFF7bjT9f4RglhD48zUrfLvqV2RONhTS1ser3NOOHAPKClb4AcuHD08GUNhK+LUllGmzArjjDBkDm/flKZfXPVzi30YFxSUsfng6CaGAM2LMPTwcNhdu1u9x+l5W+OddTX8y7jqVgRhWd9xtN7gCATIsmgfWu+r3x4emg6SwgAIgRK30BeO+p6VZV4SDSmqT6n65MkOwF+vDUdKuucIAGW3v2T1cmWK0AZMhT060phbPyObcxfS2F7azAdSDwx1PTrZLcnN+72cqfrkyUHMeAFD013aoo/O5RX6RvRWF90XQdCNx5arrFgHPkT1cmWOmbYVF90VS46ve2pBrjAAB8xkpfAF57aqZVk9EtGS3LqEzCFxiA0ZiMRNm2sBIayJg/XZlYlFE5qvdd3yOKViZktPTUTCt4aqZV7esDQ6E9NdOaklFbRuMZ+P52En/ByJQ/XZkIZFSSUSsD37+ilX0yuvXUTKtDfVFMT820yhn4HmanINOi+qIso5syOiGj4KmZFmeVA/AWK30BeOvpmVZT0glJ839cmKi7jQbwz9MzrUCcebaTyT8usKINyKqnZ1oNSadcx1FgK5Lqf1xgJRce93Q4UNqUdNxxKL3oLxTY0zOtmqQbruMoMOqLgnl6plWRtOQ6jqz44wIrfX0RfXebklYlVf64wIpfAP5hpS8AL0UJ37KkAwzgAEgIK32BDPvjwkRN0qTC4x2Qvn2Sbj0901p9eqZVf3qmVXIcDzLg6XBVX0fZSvhKnOdbaH9cmGhIOiBp2XUsBbW5vmAFXf5VXAcA7EU06bssKZDUfnqmxZgAAO+w0heAV3pWDnSiwV4Ae/T0DOcs7YJVQYAHMrqqsKhuS2qyS0LxRCtj6sruDiL7/7gw0XEdBNxjl4hMWFN43nKd6zKfnp5pLYp22SOs9PXT0zOtKUkNSVN/XJhg8hgAb5D0BeCNZ2YfDeo2/nCZwURgGNH19CvXcWTcnT9cnphyHQSA/jwz26oqHJgZdRwKwq08G5Kaf7jMtnh59sxsq6Qw2XvCaSA7W/vD5QlWFuKRZ2Yfbd+5z20kkHRHYV2x6DoQxOeZ2daqaI898ofLJH19FY2bNBSOQ5L4BeAFtncG4JOqpCoJXyAWbFO0u5LrAAD07w+XJ5oK720tx6EgTKTckPSrZ2ZbzWdmW0ygyZlnZlulZ2ZbTUnvK9sJX4mtnbFJ1J8sS7rpOBSEq0FffWa21XlmtlWLEizwWDQJj4QvcuEPlydW/3B5oiqpzP0JgC9Y6QsAQAF9JOyM33IdR9b9nlnZgJc+MtuqKVx9yKBjdqwo3M6z+XtWSnjrI+EKyZr82rZz/veXOa4BW4u+0w1J445DwYY7CusKVv966COzrUDZ3erfCfqUAIA0kfQFAKCAPjJ7l/PM+nPg95ePkZwAPPSR2bslhdt3MvCYPT0JYO6xWfeR2btjkqYUJnt9TIy9/PvLx0geYUcfmb1blzTnOg48hrrCMx+ZvTsl6VXXcWTN7y8fI+kLAEgNSV8AAAroo+fvBiIR0o+Xf3eJgWLAZx89f7cqzvrNskeD+r+7xKB+lnz0/N0phcnerG/fvJv9v7t0rOM6CGTfR88zWSjDlhV+Notcz9n00fN3xyR1RHvrA353iaQvACA9JH0BACigj56/uyo65P24+btLx2qugwAwnGggsiH/k1d5t6YwARwoHNhfdRtOsUTXSUVhondK+WgnrP3u0jHO4MNAogkPDYXnkyN7SABnTFR/BPJzN4jEkfQFAKSJpC8AAAXzsXAVw/uu4/BE67eXjlVcBwEgHh87f7eicKCYgXw/LCtKAv/20rHAcSy59LHzd8vaSPTmcXXjnd9eOjblOgj452NhEqsmtnzOuu5uEYvUE258jITvrn5L0hcAkCKSvgAAFMzHwq1Ob7mOwyPP/pbVZkCufOz83brCwfw8rGQskpbCgeW2wkQw9+YBRAPz3SRvJfp93q+B+d9eOlZ3HQT89TG2fPZJ724RwW9ZBZw4JtP1h6QvACBNJH0BACiYj1+42xRbnA7i5d9c5FxfIG8+fuFuSVJd3A99tqIwAdxWlAz+zUUSwZL08Qt3K5J6k7wlFXNQfvI3F1n9h+FF11RTxbyOfLWsKAEsKaB+iM/HL9wdU9iGOuU4FC/85iJJXwBAekj6AgBQMB+/cLcjBqwGcfs3F49VXQcBIBnRQH5drOLKixVJHYWD/KsKE8Kd31zM14qv6HsrhcnczYU6PsJAO+L28Qt3qwrP+837Kvk86k0Ct/NWL6QhmjBXk1QV10DfqIsAAGki6QsAQIF84sLdsqSHruPwzNqvLx4bcx0EgGR9IhzIr4uEWZ4tayMRvNrze0nSr1NeEfqJjcRtr7LCFbpb/bkkvp+DaP364rGK6yCQP5+48Oi8X44J8NsHdov4NauBtxS1kaYkHXccipd+TdIXAJAikr4AABTIJ+buNcQ2XHtx8tfzR5uugwCQrE/M3WMgH73W1JMUHgCrxrNh/tfzR+uug0B+UWfkUu9uEW1JnV/PH91LPeC16LtdUZjonRLf76H8ev4oSV8AQGpI+gIAUCCjc/c6YpXQXrTW5o9WXAcBIB2jGwP5c65jAbBnk2vzRwPXQSD/RufulcQZ8XnX3SkiUM/RAWvzRzsOY4rV6Ny9isJEb0VMXooT/UgAQKpI+gIAUBCjc/emJL3qOg6PMXgMFAwD+YC/1lhZhZRRZxRWd3Vw75EB3WMElLX+Q5TcHVN4fEBZ4dEB4w5Dyrs7a/NHp1wHAQAoDpK+AAAUxNjcvUDM2h7Gyur80ZLrIACkb4yBfMA3d1YZZIcjPXUG2+Jis26CuFeQ0HNVen5fErs9uXJ6df5ow3UQAIDiIOkLAEABjNXvVSQtuY4jB+ZX65wPCBTVWJ3kL+CJ06t1Btnh1lidM38BaP9qPT/bgAMAso+kLwAABfBsnbN8Y/Tyr+pHF10HAcCdZ0n+Alm3/1cMsiMjnt1I/lZFexwokpu/qh+tuQ4CAFAsJH0BAMi5Z+v3GpJOuY4jR9YkVX5VP9re9ScB5NqzrOICsmjlV3WOY0A2PVu/V1VYZ3CGKpBvt39VP1p1HQQAoHhI+gIAkGOfnL9XlXTLcRh5tCap9su5o03XgQBw75Pz98YUruCqiVVcgGs3fznHyipk2yfn71UU1hnHHYcCIF5rkqq/nGNnKACAGyR9AQDIqU/O36+KhG/Sbkqq/3LupVXXgQDIhujeW5U04TYSoLAO/HLuJXbjgBc+OX+/pI1JQ+wYAfiNviEAwDmSvgAA5NAn5++zpXN6VhR27puuAwGQHZ+cv19WOIjPub9AelZ+OfdSyXUQwF4waQjw0pqkRYX9wY7jWAAAIOkLAECefCocLKqL7UVdWJHUlNT8BR1+AJFPzd9n62cgPfO/mHup7joIYBifClf/1hTWHaz+BbJpTVJDUuMXrOwFAGQISV8AADz3qYv3y5IqIqGQJcuSgqi0f3GBJDAA6VMX71cUDuKz+heI35qk0i8uMPiO/PjUxftVSVPi7F8gK1Yk1X9xgV2eAADZRNIXAACP/M3F+2OSylGpRIUVAH5oSepsKvqfCy8FjuIB4Eh0L69GZdxpMEB+zP/PBVb5Ip/+5uL9ksLkb1XUG4ALtyU16bsBALKOpC8AACn7m3Cl1056/72b5JU436sIWj2/X5XU3uJngl0eY/V/Lry01f8DkEF/E+7WUFU4mM9uDcDeLP/PhZfKu/8Y4D/qDSA1Kwq3cG7+D7tIAAA8QdIXAICEffrio3O5GJhBmpYVnTH83wxSAF749MX7UwrriimxiwPQr2VJFeo6FNGnSQADcVuTtKiwDxU4jgUAgIGR9AUAIEGfvnS/qnB2MIP3cGVF0tR/n2f1L+CTT18iAQz0IUz4nifhC3z6EglgYAh3JC3+93nO6gUA+I2kLwAACfnbSw8qkpZcxwEonLFe/q/zRzquAwEwuL+99IAEMPBBN//r/JGa6yCALPrbSw+6CeCKOAMY2M4dhat6F//r/BEmDwEAcoGkLwAACfnbSw8WJR13HQcQuf1f549UXQcBYDhRArgiVnKhuFqSav91/gg7WAB9+NtLD0ramDg04TYawKnu1s2BSPQCAHKKpC8AAAn5zKUHHTEgj+xY+c/zR0qugwAQn8+EK7kqYiAfxXBbUvM/zx8JXAcC+Oozlx6MaaPeqIi+CvJvRdFqXuoPAEARkPQFACAhn7lM0heZsvKfsyR9gbz6zGUG8pFLK5Kakpr/OcsRBUDcPnP50SrgSlQ4QgC+W1O0kldSQN0BACgakr4AACTk7y6zvTMy5fbPZ9neGSiKvwsH8ivaSAQzkA9fdLffXPz57JFF18EARfJ3lx+UtZEEZgcJ+KKlKNH781m2/gcAFBtJXwAAEhINmgRioB3urUkq/5yZ7kBhRXVSRVL3V1YCI0tI9AIZ9HeXH1T0eN1BvwaudVfytiUFP59ly2YAAHqR9AUAIEGfXXhQVjiImffB9RVJnR3+fVVhx3yvypLGdvmZkvL/Pu9FS1L1ZzMkfAFs+OzCo5XA3YH8cYfhoJiWFW2/+bMZBu0BH0R9m95JRNQdSNqyogSvpPbPZljJCwDATkj6AgCQgs8uvDaldM5ZbO3y722FCdjtBDv935/NHN7p/2baZxdeKylMDG9nTOHg1U76+Zkul1viLSva4uxnM4cDh3EA8MhnF16rKLzHsRoYSWhpY+A+8LlNASD02YXXum3jijbqD+oO7FU3wdtW2PcM3IYDAIB/SPoCAOBAzwDJblZ/NnOY2cwFEyVe9sLrxDyAbOmpq3oLq7rQDwbugYLalAguiboDW+tOBOqIegIAgNiQ9AUAAAAA9O3vF14ra2Mgv/t7BvSLaU0byd2OpPZ/MHAPYAtR3dGtMyriaJYi6NYRnagEkjr/MXO44ywiAAByjqQvAAAAAGBof3/lsWRwqef3o86CQlyWFR4PEUS/tiW1/2Oa3SUADOfvr7xW0cYRKqWouDwmBYPpJna7dUNH3UlA1BEAAKSOpC8AAAAAIFH/cOXRtvWbf2VgPxta0a+9A/erktr/zqA9AEf+4fGEcO+v7C6Rns1JXSmcAKR/n2ZnBwAAsoakLwAAAADAqX8IVwmPaWNQX9oY3JdIDu/FisLVVtLGyitpY/B+9d+nD7c/8L8AwBM9E4q2q0PYaWJ7vXXEo3pBG4ldJv0AAOAhkr4AAAAAAG/849VHg/zS44lhaWMFcVdJ/p4Z2Tsg39XZ9He9A/SS1P5/5xikB4Be/3j1td66Yrd6w6dk8Vb1RNDze+oIAAAKhqQvAAAAAKBQNiUAdlKKyqC6q6b6+lkG4QEgu/7x6mu9K4h3UhnwoTv6YNJ2y5/7f+cO9/NzAACg4Ej6AgAAAAAAAAAAAIDHRlwHAAAAAAAAAAAAAADYO5K+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgMZK+AAAAAAAAAAAAAOAxkr4AAAAAAAAAAAAA4DGSvgAAAAAAAAAAAADgsSe3+wdjRsqSpqI/Nq1d76QSEQDnjBkZk1Tu+auypLE9PlzQ8/tVa9fbe40LAICdGDNSklTq+avNfx5GJyq92taur8b0+AAAB4wZqfT8sbL1T+0o6Pl9h7GTUM+Y0qqkRd4XoDi2aJMzpoRUReOaVYXfu461602nAQFAioy19oN/Gd4YO5JGe/66Jalh7fpiOqEBSErUAR/TxqBG99eJFMNYUXifWZXU1sZgOgPoAIAP2KLu6v65JGmfm6ges6awPpMeTxAH0a/UbwDgSM+k1oo2JgQl3fdpRb+2FfZ5AhUkYbHNmNIdhWNKgYuYAMRnU7u8d9FAmmNKywrvrZ1NhTY3ZMxIoMe/j8uSppiABCAPuvXwdu3q7ZK+NUk3tnnMFYWdlUWFFWknjkDhr2gGX7cDXY7KqKTb1q5XnQUGSY9mrpd7yrjLePrUHTh/VIowOAIAeNR4LenxwfksJHXj0h2gavf+yiA4AMQn6qNWekrW6pFlPd7XCdyGEy9jRuqS5rb55xWF40mBGFOCHrteu2MW3UTNTWvXa47CQiQaU6poo33OmBIyLepPPtzin9YkVfguAPBNNKGyEpUpbfRt5q1dr3/g57dJ+gYabHZWd8We9Pi2G93BLElS3joyRbFpq9/ubL7eX0e3+a+StJ9OXHo23QAq8qMxPoiWosEBSQGzN9O3xUq7rTx279+Fk9UOW2w3tZ3KFn/Xm6TJTWehz8826PPhEtnasCfGnWzenv5RTGLmd+b01FvdBG+aqwOyqHeAqqMcJgJ2k6N6ptLHj213v3q0C0oe2tHRe1HS9vVu9/X2K/X7+BZHn2ynpK1fZ0fh5xnEFhQ+ILp/VOVvP6ilqJ8jz/s6xoy0NdhnsN2YUu/vGVPy1DBjStaum8QDxCOMKSEPdlnMRuI3Y3r6TZXtf2rLo5a2Ens/oY9+XUnb93O8neAdve6d+kCD9uF65aKfG7eesZDSprJTW6ll7XrlA4+1TdL3g3+ZnN6t8JAdcQ26Tvp4Y/NJdBOeUj4b5LtZVjRLnO9ZsqLOXyA337HeQaB+jSmdWLesXH2zh8lew9jt80wjjpOc6eNGAQaSkrKsKAmsjZVRuRukSvle1Ku7+noQacXp7c45Uac10M4TRJPS2v1HHpNWu2FNUpUjk+ITTeSbklRT9lbzDqulsK/j1Xm4UV3/qxSfkjGlbGJMyROMKT26z3IfyQljRpqSTuzwI2uSyj7VrXlkzMiUpKbS6yvs1ucrKbm2pDeTDRz34aS99c19Ene/s7+kb1TZL8X4xCg2GugJiCrGbnF1E86aNW001hlIixl1w468vs8V9LPNRbLeFz0D8hVJx50Gky8r+uC2dR2nEQ2hoPeivvi6ysmYkUVxzW+FOigG0T2jqp0HdfPCm4FC6VFf9VXXcSA3vO5rZRVjSltiTCkn+pxIuqywbs1zcinTHE74dWXLbXizZpcjOpA9W36vntziByuJhwJgYD0DGzTKtzaqcNDnhDEjNNbjR0N4ex3XAQyp4zoAB/g+J6wn0VtV8VYMpGVfVB4l1YwZkTZmxgbRX/uycqHjOoCMWnMdwBDaIum7FR+ux8yK+kR1FWuQcFTha55yHEe/+tkKHUDKGFPaFWNKxTIuKTBmhMSvO0V73315vb7EiVBnq7/caqUvM7IRJ2ZlDiHaGquqfG5XlpY1hduFNHxeAZUF0WzgqjbOFyjqd7K7hdyqpGYeOoEF+Gx7t/3rSKrRsUuGMSNVhQNJtCWzpSVpKuvf+wLci/rV3Zq4o7D94mWSMGrH1rQxqXjHcxtzrLcOChR+ppm+FrOooMneXt6sEC/gyh0kizGlIUQTMatRKWq7algrChPAjCl5YsB6iBW/jkR9hYbCfl9aR62kqfdos6ZPR4xFq30r0R+L2ofzxYGtxgu2Svp2REMA8aGBvgfR/vk1FWO7sjS15FlF65uoU9ktlaj4VqesKTozMyodXwfc4xI1xssKG+JlhZ9r1gbzWtr43Fape9ITXfc1hYNJdAay67S16w3XQQxrUz3TvR/5NkCwrPB+1dFGPdNxGI9TUTJPCj/L7mfq071kc7uBOihGPQOCRe8X+ZT0XZVf1zCyjTGlPSjYFvhpailM/no/8TvP9jD56La169VkosGwMtz/6+4IECjszwVOo0lZlLvoHSOsiPZf6rY7CuqxpG90Eb2fUkwoBhroA2AGe2pWFA4eNZnNl7ye2cU1ZbsBsCypTgeuP9EgbHdVnqt71orCe+Yi13L6GEzyjhdnCO2FJ6tY1rTR9ug4jiXzes4azPL9hXZDwqLvQVPZbj+m5aa16zXXQewmGgB86DoO5ApjSgOIdt2pijGlpNEPzbA97jhB4tcjUf+vLjd9hW6/jt17NmERW+pWrF0vbfUPI5v+zNkrgAPGjEwZM9KWtCQa52nYJ+mGpI4xI/UoeYWEWLveiRINJUk33UazrZvWrpcZuO2fteur1q43o1UnLyv9cydvSypHMdDQTpExI5WoI70kGroHP4AAACAASURBVPPIgG49E3V45l3Hs4VlhferOgnf/li7vhgNvO3XxnbXWTJPuyE5xoyMRcdOvSoSvl2+tHUYUwIcMGakGu3ceEuMKaVhn8L3mjGl/DhhzEjTdRDoT9T/q0o6oLCvlZbefp0vbbPUWLvezngfLm862/3Dk5v+TAMdSFHGVvZuPvOys8vPl6Ii+bu//6ikOUk1Y0aYpZWw6L2tRRMcbrmOp4cXKyeyzNr1xWimZaB0ttm5wyzc9GWszurXsgYbKPe1PutHIbapt3a9Hk1KWFQ2PssVcU7YnkVJ8ko0CJeVSSa5XTWfBdEKgUUlv2q/d1vuTlRWtzwTa2NbQSncuq67lZ1P9WFaGFMCUhS1z5vKxk4nw4wp+Xo/fWxMifZBZuy1LjphzIgYa/CHtevt6D4YKPmxKPp1fcpoHy6Pth3j2by9cyB/K1pkE1vxbCEaOGjKzfXWbYgHivm80qiiLWnjPFffBs9XFG7T13QdSN4ZM1JTuNratWVr1xmcikl0b2sr2et+TVKJhnZ6HNdZO1nWxpmoq9GviqvdscUgf/fXMWXjDKFBFapNFm1vmIUJRoV635OUkb4q7YYEpXDdLiuszxbjWnUf9X+625EnmXTxYrJBRq5T5Av16BaiCTINuRtTCrRxln2SY0q+3U8YU8oAY0bs7j+1IxYGeCZabd9Wsm0x6qM9iHbvOe46jpzatn+wOem7Kr8SNMg+bog9okqoLulUik/bbZAvSgrS3lYw6oxUouLLTX5ZUo3vbrIyMij0MlszxiuFAVsvBj3zwFGdtZ0V9QwuZeH+HNVvvcX1/Ww3zxZtskQG6plWtAU+YhBNxHjfcRi0GxJizEhd4WqpuK0pTPQ2ku4HJXzWvRffvRgG2oHHWLtuXMeQJYwpeTOm1FI4plSInXayJqa66CTJe79E7bClhB6eM5/3KKq3OiLnmIRt71OPkr4Z6UQjf0j6RowZmVI4EzONbXfWFDbIF7M2OBC9D92S9Rv+bYUN9UINkqcl+i686jCENWvXOXsnAQlPItvPmZjJi5L3Dbm9T9+Ro8GlvcryoFQRB00T7vj3w4skjU8cbxG2Ep0bjZgl9LmuKazHUj++JRpbqSve15T5fnVUBz50HQfypYjtl+1E/eem0mmfM6YUj5sKV/4yppSiGCcgkfj1THScXBK7cmW+HZZlbPOcmG2/l71JX9eD78ghGuiPZrQ0lc7g77LCwY1FHxqVUVKhqmyvjlqTVM1aRycvHO8wwUy9hERnZCcx+5xtNROWga2cu4leL+qx3UTt64qS3/ZzN4VNVhkz0pG7975wq6uT5rjPSrshAQkNArUUtt87MT/uQGI+azPzg40Z2lYfOcKYUurt85akpg+JrmisbUrZH1NaUbiYgDGllMS86wSJX48k1BYpbF86Lo4nBq5o9zPmJT+P8dq2f/Bkz+99G0Ttnku6m2CHfysp/VkG87v8+5j6/yx8Oy+1cFKcidlSOHswSPh5YhU1nJpRJ6amsLGete/0qKRXjRm5o3DwiMHbeAVytxoucPS8RRAomaRvkMBjIhKdtV1X+vfhFYV1ZdP1AH3cosGdRUm1qKNTlZu6rpPy82VJIDezipdpMyQiKOhz51K0pXPc1+dpa9cbMT/mnli7HkT3/rqycVRC0hhTSgdjSgWS4pjSbYVt8SDh54lN1M5qamNMqa5srv7dp3BMiZ3k/HTLmBGR+PXGouJP+gYxP17hWLveNmZkTW7Gmspx33ej9v12O0dubod1/xx7UnmnOrt3pW+g+GZG9TaeO3p8oGlVuzesO2kM+rnY8s3FLMWo8VPq+aveP1eU4EyGos7KTPGcFS+TvduJ3rdaVLLWUJfCyqKal/c7CxI8v60fmV8x4asEj4xglm0ConvvotKfIb+isA5rpvy8zjnY6aKwZ8tGkxluOHhqVoUmJMFt23ZDuyFGCazEWJM0ldXPKIbXm/nvX8xjSr2rMtoKx5G6GFNKGWNK6Yva5w0lP6ngjsJEZCfh50mFJ2NKU5z1m6yEzpdnLMITCfQV+OxjEHM7sV+ZGweJEsbdUtEQ39Wd2ki9Sd+9brHZUjjjoa2wYe1NxVWUBnq/er50lagMvQ1Vll9vUqL3salkB6NynXz0oKE+b+163XUQeeBym8Yi3p/SlFBHK/MDnr6J2kKLSvdeW9hk72YJnfu4lcImIB2e60tbISGOBgxoN8QogS3e1iRVsj4WEb3uQHuoc334/g3R9mNMaQBZ/i4wphSP6H1cVLLHUywrTPYGCT6HMz1jSq4mmO8mM7tS5FFCYxGSdMCnOqqoEjhujHGoGCR4DNxOMpf03SwaE5pSWGcNVO/v1EYaiR58TIN1PJYlnVR4TlXF2vW6teuL3Pj8Zu1629r1prXr1Wiv+v2STiscnEUfogRWoGQTvvPWrpfyXOFYu74aDZSWFW4zlDVzxowsRvdODIetjfJrOYHH7CTwmIUVrbRfUnoJ3zVt1GHNlJ4z06xd70TJ2P1Ktr7rJPjYWeeqnuk4et4iCFwHgL3r2V0iTplP+Ephf1thImzNcSixiwasBtESY0q5s8WY0gExpjSQaFeAQMklfNcUJhzLBRlT2q9wNXPW3GBMyUvdYxuQbZ04HyzP98qUMf67hWhMqBG1m06q/37CjmOuI9Gv/d6w1iS9HDUOmpxDkG+bvnSTCjtm2EY0eP6qkhs8X1Y4q6ye0ONnTs9g+KSy11E8Lhp8ceg4et6sfZ/yKPY2Ql62HXPNmJExY0YWle7M95bCs1TqKT6nN3rquwOivRUrhwmEjqPnRTJoN8SnqXiTGad9ShRGsVZdx5GAfvtEKwpXzFQYU8q/KAnMmFKfolVQt5TsmFK5SCtMozb2lLI9plRyHQj6NirGAX3gTbuwYGjz7SJaHFFSf4todnw/u0nfSh8PtCypZO163LNy4QFr14NoOfykklm95a1o8LypZAfPb0aTLQpZcUXfv5KkedexbDIuGnxDcZjEc/W8gFM9W0seT+kpu6sJKiTtdxcNjlY02AxPAMnruA4gD6JdkeKsf+74mLyIxlROuo4jZv30h7oTwIKEY0EG7XFMqRBJ4p4JmUlue9kdU+ok+ByZFd13ypJuOg5ls3FJbcaUvELiN/viTC4Woh5KSSFzGoOKJkRWNGT+rZv0Le3yc8sKt0wiI19wUUO9rP6Sb7kfrIy2YgmU3Fl8awoPjK8l9PheiVaIHVC2ZmiOSnoYbcMEYEPHdQB4XE/CN8kjCHp124/eDci79v/Zu/vrto3l4eMDnvu//KtAuBXIqcC4FVipwHAFUSowU0GUCkxVcKUKAlUQqYJLVfCYDRDPHxhaNE2ReFns7Mv3c45PHJnEriQCWMzszu7N8HT1kNk4Og4Qgsa6AxhOn5tWDg+5kW7vqyjpdT7EbWzGqs78+6NOACOmlLm9mFJoyTcTezGluSZk7io2Rnu9dEVLPt9IN/EgpHjlLol4bd0R9EbiN2C5LphCOnS8POme0Ke880ZI+OKAJt/OzU5O+iK7NzifK3i+O/dWMx0/Snrzfi/h7cvylcQv8IO14+OFNNkjOnp9+kf87d97J5HssRgqDUxVQlDUBe/XD1ayAT+5Ebf3oNsEVqzdSDrjm/LEv73IxMAV0qPJt9RWvA+iZX0bmT+mRMXGPTpGKyWsmNKFiPyXmFJUSPwCmI0+55yaIHoy1rZL+p4aYNQkfHGMJiN/t+6HBY+Dc4LlR2gg/FrC+/yR+AXms7buQKz0uvTVY5O/t+2W8aMjBEWdWFt3AMiZPju53ApnIyLRV5HQ+2Rt3Q9HTu3TzJgAR2lMKbQtnLzQRNGTzBdT2u3fS0zpiL2YUmifP2JKcdklft9ZdwQ/cTWpbu3oOMAYyxP/dnpP3zMzUh6ZEYZTtGRjVvXtPQ3OSwbn5+nnL7TSPAzSh7PYJ5zzC1kwSPh+ppyzexoUJfEL2GmsOxC5pePj3aeSRNQVZ1GXeS6KRXXinx+ofIBTtIpcjjGlRuarwLPbYmU90/GToZ+/X4WYEsYj8RumdWDHAT/LwfQ+PipmvpDTZXjqMQdFdmrrDviiN/F7mW9wvhGR61SCGD5oEKESBukxs/i8c44heZ4Tvrv9wlae2ssOiV8AMdLnJ9elfVObXLQ88+8WEySHKN/4etT7LsOrpXUHfPGY8OV5tydd7FQJMSWMdyUkfoGTmIg02qgFuQt5ez/fO34Z6GPKrIOY7O3he6p01RS7ks7rmY6fLF0VXUpYn0MG6QDMGCR82S/MA038Rr0iDEB2XO/lu0mtIlKPPbtCT96Ub3w9hX2X4YFO5A7pWX4WezElFhEERu8rlYT1OfxaFAv2Qx/IMPFK4hfAHJo3vn52T9/yjX9bju8LMpR0oHdvcD5XSWcR9vCdRB9sKglvkH6qhD4AOGdQ0rnm/uVP225rCeteB/jG9SYutePjNY6PF4qYVy+/9bwT8/cE/xrrDszJU8KXRQQTBJr4XRFTGszy50XiF4Brbz37nt7TV44nfR8YKGCg1IMv9zJvwvczAfPpAk38NgzSkam1dQdyZLSHb9ITvwJ1LWGVoAO8YQVTPHQM7LpKUpLPTPosGNIzzBDHgtt3nKsYaH3ka0l8hjwtIrghpjRdgDGl3X6xpXVH0BuJXwDOjB1PL974+mp8V5CpJAbjxxTFYiUiH2Zs4o49EN0JdJC+YsCHDK2tO5AbDa77TPj+zv3Lhk7OXA54fTNXXwDghHqGYzYzHDMUK+sOOMSEMAx1LGGZShLzVuZN+P7FmNydvZjSi3FXdi5E5J6YUlRI/AJw6fHI19an3nA06cuKDaBTFIsbEfk0YxPP0u1zBYf2BumhrIK6krSCOAACownfxmOTd227pWyjIf35hzLBCT869lAG5Ii9CIdJJQ6zIaYEdIpisZSZY0ptuyWm5JjGlEKqrHMllMyPDXFAALM5V6V5IT+v0HyYrTdIVoorSIpiUYnInzM3U1P2ah4BJn4/6iQCAHBKZxCvZL49wg49676ysMd9BUCQtBSl69LOST537mjwJoXJPCR8McbaugOuFcXiWkS+zNjERphcM5u9PX5DiSl9IqYUnY9aPRL+ra07AFhayM+zTpb+u4FERVuKR4MUcz+s/sGeK/PSn29ID0F/sr8vMFpj3YGArWTeknH7CC4FRJMfrCo9j/EW4F9l3YFIxXi9Wu39fSOsRsMI51asxEZjSquZm1mm9nMLjcaUQkq0ElOKzycSvybW1h0AZnQ2BrTQsju/iMjvIvJvklCY4HBW8tqiE47cy7wrpp7bdruc8fhQGhD/3bofe9iLBYAzWjLuo8cma4JLwVladyACVFUB/KusOxCp6OIxupfoLyLyWUTeE1PCBId7qK4tOuHI3DGlR7Za8UOvcX9Y92PPiphSdEj8ApiiOfP/P1mIdDOX2nZ7SxAPEx2ujI2yrJMG0OdeMRXSTMHk6cPQnXU/1KUQoAfggG5DMGfJuEMP7NEXHp3cdBgkBQBrpXUHIhVlwlRjSitiSpgolZjSrRBTSoou2ghlO8QrIaYUIxK/AMa6ldfVvY/So6rOYtbuICs6CPpduuTarzE+8HkKoN+lvBdVwG4knD2yftPPGgCMsrePry8bEak9todhWOkBIDQf5jgoZS2BpC2liyn9JV1MKbpKHfqc/9vMzdyxot5ELeFMtCSmFCcSv/FprDsAtO32W9tuq7bdFvrfs+Ojf/noGPIRc3kZjwH0pYc2cKBtt9+KYlGLyD/WfVGroli8j/FBFkAQVtJVDvCl5noVtHsR+dO6EwAg8n0vy7mkXtLy2L2W+y+yoGPN2GNKc69O3girfE1oTOlaAoopCVU1YvSpKBbSttvauiMA0sVKX+DVUuYPoN/FuAI6FTobNpT9fS+FhzUAI2iwwec+vo+UdQ6bji1CqWYBAOWMx056pe8bq/dY0QfEYSXz7uMrInLLREw7eo0OZX/fS92eDvFhxS+AWZH0BcRbCR4RVvma09Xoj2df6MeXmVdCAEiMQVlnEco6x4LEPIAcJJ30VYeTeLi+A4HTmNLckzI3EvFK6FTo1nahTLa8IaYUrU9ajRAAnCPpC3RWHtpglW84aukemEKwsu4AgKgsZf4VBPu4d8Wjse4AAKg5E7PVjMcORS1dQuFFRH5n704gbB4nZbLKNxy1dQfUhTARIGZfSfwCmANJX2RPy6H42Bdx6aEN9KAJjFAGxh90VjAAnOSxKsW+pef2MFLbbhvrPgCAmnPf3cuiWCS92rdtt09tu33ftttSqxQBCNuN+IkprTy0gR4CK/P8kZhS1Ej8AnCOpC+ypmVQfOyr+sBKqbBoSZ4X634ogjkA+vB9rWCVb3xCKTUHAHOqrTsAACLfY0pfPDTFuDw8txJOTGlp3QFMQuIXgFMkfZG7pfgpk7ny0AaGq607oK4Y4AE4Ra8RV56bXXpuD9MdK/kXynYGAOBKreVUAcCar0mZK0/toCctte1jEUkfVJCLH4lftyiFj6yR9EW2tCzYJw9NvbTt9t5DOxhIS2E+WvdDLa07ACBMGtheem6W1QRxOrbvI3tBAkjNhYhcW3cCQN40yfbRQ1MvbOMRJo31EVMKS2XdgQlI/LrDMzCyRtIXOWNGJkTCWe17WRQLglcAjvG1T9i+pef24AYzmgHk4pbVvgCMLT21w3ZQYVtad0Cx2jcNJH4BTEbSF1nSgdAHT82tPLWDEXQl2511P1QopYEABEID2r6vDY+s8gWAHzTWHYiMj9UVF8LYGYARzzElKscFTFdhP1j3Qy2tOwAnSPwCmISkL3K19NTOM4HzKCytO6CYmQng0I342Xt+38pze5gXpa0A+Oar6sAX3bIHAHxbemrngZhSFEKZhPShKBaldSfgBIlfAKOR9EV2WOWLQ4Gt9q2tOwAgDEarfDdtu115bhPurI98jZLPAFK2su4AgLywyheHAospLa07AGe+sg0cgDFI+iJHS49tMUCPx9K6A+oT+5MBULX4X+XLfStux1b18jsF4JvPCgNXRbFgv0sAPi09ttV4bAvTrKw7oK6JKY0WSpnufSuqmgAYiqQvsqJlTnzNyHyhDE889HcVygCvtu4AgCBYlAkjQRixtt0+yY+rDO70awDgTdtufVcY+I0SiAB88LzKl+3CIqJ7+z5a90O6ScOsDh3nVkQ+W3fiwIWINCR+zaytOwCMQdIXuVl6bIvAeXxCWSUQyn4wAIxo8PrSc7Obtt1y74pc225rEfmPiPyifwcAC74D318JiALwoPbYFuPy+BBTipxudfS7dT8OkPg1wsQbxIqkL7Kh5U0+eWyy8dgWHNCZmc/W/RCRSwZzQPZqgzYJLCWibbcNK3wBGFsbtElAFMBstHIcMSW8SSfQvlj3Q7qtD0rrTsSqbbe3Es4ezTskfgH0RtIXOak9t9d4bg9uhDIzs7buAAAbnrci2EfSFwDgisXEEwKiAOZU+2xMJ6UjPsSUEqAVk0j8AogSSV/kxGd5k2eDvazgxr2IbKw7IezBAuTMpBwXpZ0BAA5ZVRvYBURLo/YBpKv22FYIe8NinJV1B1Rt3YHYkfgFECuSvshCUSwq8bs3YuOxLTikyfoQEh+UeAbyZTHpg8ASAMAZ4xVqFyLyxFgagCtFsbgWYkroQWNKD9b9kC6mVFp3Inaa+A1hG7h9JH7PoFICckfSF7moPbfXeG4Pbq2sO6Bq6w4A8MsgoLTTGLQJAEibZdCbgCgAl3xPymw8twe3VtYdUFSQc6MSEr8AIkLSF7nwPdCxKmcGB3RG2It1P6QbWALIi9WDeWPULgAgXY1x+wREAUxWFIt3IvLJc7PElCKm2+awbVh8qmNf1NXblZD4BRAJkr5Inq6auvDY5KZtt2uP7WEeIZR4vqIcD5Adkwdzyh8BAGYQwnh6FxCtrTsCIFq+x+cvmmRC3EK4B37QSQuYaC/xG0Iyfx+JXwA/IemLHLDKF2OsrDugKusOAPDDYJLSDvv5AgCc04mwIayKuRCRryR+AYxETAljhJD0FSGm5AyJXwCxIOmLHDBAx2Btu30SSjwD8Ksyapf7FgBgLrfWHdjztSgWK+tOAIiHrpL86LlZxuYJCKjEc2XdAc/KOQ+uscJKwvjd7iPxC+A7kr5ImtGqKQbo6WisOyD5DdCBnFntucR9CwAwl1BWOu18KopFQ7lLAD1ZjM8Zm6cjhHtgZd0Bz8q5GyDxCyB0JH2ROosB+tqgTcwjhAH6JUEpIH36YHZp1PzaqF0AQOK0FOKddT8OfBCRJ4KiAHqoDNpkP990NNYdEJErYkruaeK3tu7HESR+AZD0RfIqgzaZlZmOxroDqrLuAIDZVVYNt+22sWobAJCFpXUHjriULihaW3cEQNC8LyRgbJ6UEBYSiIiQAJyBlvD+bN2PI3aJ39K6IwBskPRFsvTm5n3VlM5mRwL0d/lo3Q9hgA7koDJqN4S9ywEACWvb7VrCGFMfupBun9+Q9h0GEAhdKed7u7DQysViAo0pPVv3Q1hIMJu23a4k3MTvPau8J+F6jGiR9EXKLEo7hzCYg1uNdQeEATqQg8qo3bVRuwCAvCytO3DCb+zzC+CIyqBNKselp7HugLCQYFYBJ36vpFvxy/hmHK7HiBZJX6SsMmiTVb7paaw7ICKldQcAzMdoFcEODzIAgNlpudIQV/vufBCRdVEsKuN+AAhHZdAmMaX0NNYdEGJKfZVj36iJ3ztnPXEn58QvC7OQLZK+SFll0CbB88QEsp/OZaYDNCAXljOvCSwBAHyprTtwxoWI/F0Ui6V1RwAEoTJok5hSehrrDkiX+MN55ZQ3t+22FhK/ISHWgWyR9EWSdD9fi1VT3FDSFMLsMMrxAOmqDNsmsAQA8EL39g0xGHroC+WegbwZV+JBQnRf3xfrfuhnGjMj8QsgBCR9kSoGM3Cpse6AUI4HSFlp2DaTlQAAPt2IyMa6Ez1Q7hnIm1VMiQmZaWqsOyDElLwh8QvAGklfpKoyarcxahfzCuHBq7TuAIDZfDBse23YNgAgM7ri6ca6Hz1R7hnIV2XULhMy0xRCTInFMX7dSBhVAw+R+AUiVBSLpVYiqvu8nqQvUsVgBi4xQAcwC+syW1pqEwAAb9p2uxKRR+t+DEC5ZyA/pXUHkJQQYkrcwzzSSW6VkPgFMFFRLFYi8kW6BSNf+5y7JH2RKhJkcKZttwzQAcyltO4AAAAGaomjzPMO5Z6BvFhV4lkbtYt5hRBTIk7qGYlfAFNpwvfTwZfLc+8j6Yvk6A3rwqj5tVG7mJ/1IK00bh/APCwfvl8M2wYAZEwrTdTG3RhqV+45lvLUAEawrMRDFZ40afKPZ68MkfgFMNYbCd9ei9NI+iJFDNAxh7Vx+5fG7QOYR2nY9tqwbSBl761Lt6esKBbX1n2AG227vReRO+t+jPBnUSxWBEmBZHFuYw5r4/atVq9nTxO/1xJmhRMSv0BgimJRFsWikSMJX+k5gehfTnsEhIEgG+bwJCIfrTsBIDmldQcAOHchIv8UBfNrgR5upHt+u7LuyECfpJvgUQeyFQwAdyrrDiBJT0LiNVttu91tEdGIXXXKt+wSv5UmqAF4VhSLUrrxx7Wczj+s+xyPpC9SxOwkzGFt3YGiWLwnqAQkp7TuAAAAVtp2+01Xbz9JeEHQc3ZB0uu23TbWnQHgDDElzIFkmh9Tzt9Zk/Jtu30i8Qt49b4oFqXPyqxa8evUdaiU1zjg7rVDrj3rPi8i6YsUVdYdQJLW1h0QHj6BFFG6HQCQNV39ci0if1v3ZYTdPr+f23a7su4MACeoHoc5NCLyxbIDmtBrLPvgQdCVQ0j8erUWVtfn7kJE/pdYBa51nxcl9R0DwIzW1h0AAMca6w4AACAiokHoz9b9mOBrUSxW1p0A4ITVZOte+/QBiJtW8KuEPX7ntrbuADCDXhVASfoiRczKhHM+S0EAyIOWfQEAACKiK2XvrPsxwaeiWKQSKAVyZrVScG3ULjzIYIUtBtDEb23djzeklPidorHuAHBEr1X4JH2RotDKYyAdIc7CAxCv3B+iAAD4Qdtua4k78ftBCJQCAIAz2nZ7L+FWOSHxC4Rp3edFJH0BoL9eJRRmxKpAAAAAJE0Tv4/W/ZjgSkTWVPQA4lMUi9K6D0jas3UHEBatckLiF0AvfSuRkvRFUopiUVn3AZgRAy0AAADk4FriDo5fSBcoJfELxKW07gCS1qssJ/JC4hdAT70rkJL0BYD+1tYdAJAUHpwAADiibbffRKSSNBK/lXE/AABAwEj8AuihdwVSkr4A0N/augMAksLqHwAA3pBQ4vfvoljU1h0BELzSugOYnfWWYSTtAkbiF4ArJH0BAAAAAEBwEkn8ioh8JfEL4IxL6w5gdtblna3bD571vt6a+L2z7MMJJH4BW6z0BQAAAAAAcSPxC8AjKvEAeSutO9C221pI/AL4We+JO/+asxcAkBhmRQIAgD7+EsYNc7mRrmQuMqKJ3/dFsViJyCfj7kzxtSgWu5U8AMJDIgOAubbd1kWxEAlzzLNL/FY6PgMQGJK+ANCf9f4rjXH7ANxaG7fPSgZgHo9tu72x7kSqimJxLyL/WPcDNgIPgvb1tSgW67bdNtYdAQAAYQp8zBND4jfUfsGvOxkee3svwyeBfRj4+jF65yVI+gIO6c2use4HACAKa+P2WckAIDptu33SABgypUHQtYh8se7LBPf67Gg9qRQA4M/augOISwSJ33vptuAIEWMsPGu5dDNFsaj0r5V05eMrEbkcebjeExl4WgYAAAAAANFo2+1SRD5b92OCC+lWyFB1A8B3e8FhpGlt3QHEJ/A9fj/o1htAiMxXe7ftttE/y7bd1m27LUXk3yLyh4i8zNUuSV8AAAAAABAV3Rf3PyKyMe7KWBcisiqKBZU3gHCwMgxAcAJP/H4i8Qv017bbtSaBS+mSv86fZUj6Am6V1h1A0sxnKAFIio89pmzzJQAAIABJREFURwAAmI1urVOJyLNtT0a7EpHGuhMAvuOZG8liO7q4kfgF0qPViyrp9yyz7ntckr6AW6V1B5Au9vwCAAAAfqRj5EpEHo27MtYVgVIAqrLuABCrHLZM0MRvqBPdUkv8rq07gDzsPcucXPHbttt132OS9AUAADAQwkxrSkoCAFLQtttvbbutROQv676M9KkoFrV1JwAAiFguz7aVkPj1YW3dAeSjbbffROTa1fFI+iI11ishK+P2ka7ZNncHkLXkZ0MDAPLRttsbEfksce7ze5vDKiUAJ3ENwFxirYbhW2XdgXM0OVQJiV8gKbowxEkJd5K+SIre+IAUra07ACBJucyGBgBkom23K+mCobFNmrwQkRVVOAA7AVTi4fxPG79fOBFJ4ndp3QkgQrdvfH3QuU7SF3Drg3UHkCwmNABpsp5xzWoCAEBydG+s9yLyYN2Xga5EZGndCQBmSusOYFaWz15rw7YxgwgSv1/YugIYRp9hjk1cHZQXIOmLFJne7JiZnTTL36116XIAaSqtOwAAwBx0n99rEfnDui8D/VYUi8q6E0DGLMvDXxq2jbStrTsA9yJI/H4l8QsM1kw9AElfpMh6RSSrptJl+bu1/lwDmMfauP3SuH0AAGbVttuliPwqce3zS5lnwI7phGv29sZMWEiQKBK/QHLWUw9A0hcpsh7IlMbtI03Wn2sA81gbt8+2BACA5LXt9l66CZyhBkQPXYrIjXUngExZT7gujdtHmqw/15gRid+fBbBHOzBWc+Rrg/ICJH2RIuuBTGncPtJE0hdIk/m5zWoCAEAO2na7li4gemfbk96+FMWitO4EkCHr8TljczhHAix9JH6BpLGnL7JnPUCvjNtHejY6eAOQnhDObQJLAIAs6D6/tYh8tu5LT0vrDgAZWhu3z9g8XVZl+1+M2oVnkSR+K+tOAIFbTz0ASV+kaG3cPgP0dJVG7VpPZJjb2roDiEKS50EgM665bwEAstK225WI/CLhB8I/ERwFvFsbt8/YPF1Wv9u1UbswEEHi955qY8DbtDrRJCR9kZy23VonBi4ow5Ws0qhd68/03NbWHUAUQlgROxfrgDMPXACA7Ohz43sRebTuyxlL6w4AmbF+/r4sioXVilCkqbHuQERK6w64EHji90JEGhK/wHxI+iJV1jc1blxwyfqhE8C81sbtfzBuHwAAE1ruuRKRv6z7csIHAqOAP5osYVImUkJMqb/SugOukPgForY5+P/1kDeT9EWq1sbtc9NKU2nULgN0IG2NdQcoHQkAyFnbbm8k7H1+b6w7AGRmbdx+Zdw+5mE12ZaYUqZI/ALROrxuD7qOk/RFqqwHNJVx+5jHpUGbmwBKlgOYVwjn+LV1BwAAsLS3z+/hzPoQfGILIcCrxrj9yrh9pOPFxf6QiBeJ39FS3mIM4Vvt/f1uaG6ApC9S1Ri3T6lMuNJYdwAIRAiJ0bmE8L1V1h0AAMDa3j6/IQZGa+sOABmxHp+HmADBBIYTd6w/ywhABInfVWh7mbMAB5badrtq222hf+qh7yfpiyS17bax7gOlMtNi+PtsjNoFpqpcHkwfUpKkM6+t9w27Cu0hCwAAC3pfriS8wGht3QEgI41x+xeBrnzDeKVRu41RuxZ4nj0h8MTvlXQrfvkdAg6Q9EXKrG9ilXH7SENj3YFEldYdAA401h0QSjwDACAiPwRGH4y7su+SJBDgh14DrCdlVsbtwy2rZFZj1K4F7pFnkPgF8kDSFylrjNsneJ6WyqDNXPbztfgeS4M2MV6Ie+u51lh3QLhvAQDwXdtuv7Xt9lpE7qz7sqe27gCQkca4/cq4fbhlkZB8ySSmhAEyS/yG+D0CsyPpi5Q1xu1TKhNTNdYd8CTZsr1wJocH1ca6AyLykfsWAAA/0n20Qkn8MkEL8Kcxbv+jcftwqzRoszFoExHIKPFLvBFZIumLlDXWHRAeylNSGbR5b9AmAAOB7Osrwn0LAICfBJT4vSyKRWndCSATjXUHimLB2DwdpUGbxJTwpggSvyvrTgCxIumLZOnN69G4G5Vx+3CnNGizMWjTgsXMu9KgTYy3tu6AJyE8lBNYAgDgCE38Wj9fivCMCXihkzKtkyGMzdNhUd65MWgzdh+sO+BT4Infj0WxWFl3AogRSV+kzjqAzgA9HZee23vWh8zkGe0x4/v3maPK4bHWDo8Vssa6A9I9WJXWnQAAIFDXYh8YrYzbB3LSGLdPTCkBWqb2wnOzD5rQA04KPPH7icQvMBxJX6SuMW7/gnI88SuKRWXQ7MqgTSBUWTystu32XkQ21v0Qkdq6AwAAhGgvMGq5JYPFajEgVyvj9i+M4hFwy+K6bb0IBhEh8QukhaQvkqYrCK33SCTpG7/SoM3cBujez1NWM0bFYjW4lRDO/dq6AwAAhEoDo9diN1HryqhdIDuBxJRq4/YxHUlfBI/EL5AOkr7IgfVA51pLuSBevgfo2ZR23rM2aLM0aDMnLq97Waz0Vdb3LBGRS6pUAADwNk0E3Vi1z8o/wKvGuH3G5fHzHVOitDNGiSDxu7TuBBADkr7Iwcq4/QthkB473wP0W8/thcDigYTJGPNytgrFaN9nEwGVeDYLZAMAEIO23a5E5M6o+dKoXSBHK+P22TYsfr5jSiFMJEakAk/8fimKRW3dCURjbd0BKyR9kTzK8cCBD57by3GAbpHUYz+0OFhfvy2EcA34UBQLzhEA6DBRDG+5EZuxSmnQJpCltt02Yv9MUhu3j5G08p/PsvwbnZQEjBZ44vcriV/0tLbugBWSvsiF9crJD+wfGieD0ml3mZbhWRu0SQB3Jo6vd2uHx4qF9T1rh9W+ANBhEgyO0nF7bdB0adAmkDPrSZkfiSlFi1W+iBKJXyBeJH09Y9WMmRAGPQTP4+T7nF15bi8Ua4M2uR7Pp3R4rMbhsaKgFSpCeLD6RHAJAIDTdBWg7zLPpef2gNyFMCmztu4ARqk8txfCZxWJSCDxux557MeR7wOCQNLXP1aWGWjb7VpEHoy7UWtZF8Sl8tjWswaNcmRR3rk0aDMXLq91a4fHikkoD+tL6w4AABCBGxHZWHcCwDw0pmSdBKiN28c4lce2HnUCMSZg4vOPIk/8rj31AwgKSV/kZGXc/oWIXBv3AcN99NhWKEke73QQ6TtQdum5vZy4XEWd60PrvYQRPGa1LwAAZ+hY1udYvvTYFoDOyrj9S8qZxkUXfnzw2OTKY1spK607EJoIEr9U8gP2kPRFNtp2ey8iL8bdWBq3jwE87+e7advtymN7IfKe3DPYszkXpasD5TpT2SB4fMrKugMAAETgVvxN2GLyIuCZPq9bT8pk27C4VB7beiGmhDkFnvhtSPwCr0j6Ijcr4/aZmRkXnyuzQ0nuWKLEczpKR8exLqFmLZTrwgcmSAAAcFpgE7YAzMP6HL9iXB4VYkp+VdYdSF3Aid8LIfELfEfSF7nxOfv6LbVx++jP1wB9IwzQRWySvgwI5+Hq55rlKt8dfaC6s+6HWll3AAAQvqJYvM98W4CVdQcAzGpl3QGhglxMKk/tbCSMzyYyQOIXCB9JX2RFb0wr426wYioCGqzyVTbtVj+buSPpmwDdt+jC0eEaR8eJ2dK6A+qyKBZL604AAMJVFIt7EflHRP6Xa3Wjtt2uhUolQLL0HLeelElMKQKaeCKmhCSR+AXCRtIXOQphReXKugM4i1W+nhnt3frBoM3UuRxcZ73SVySYwNLOTeartwAAbyiKxbWIfNz7Us7j25V1BwDMamndAQmjDzit9tQOMSWYIPELhIukL7ITSACdvX3Dd+OpHWZk/sj7yghmSTtXOTrOi16v0V2PrLcmEOkenlbWnQAABOlwwuSFVv/IUWPdAQDzCSSmxGrf8PlaSEBMCWYCT/z+IyJfrDsCWCDpi1wtrTsgYfQBR3gsw8OMzJ81Bm1WBm2mzNVsyntHx4mePkiFcq34UBQLX5NiMFFRLMqiWFQEBaW07gCQgfLI17JcYaEJobmDnyFMBoMBVi4FY2ndAWEyZrB07O0jpvTSttulh3aANwWc+AWyRdIXWdIH8b+Mu8H+iOHyldC4YUbmTxqDNiuDNlNWOTpO4+g4qbgVkRfrTqglZZ7Dp7+jJxH5W0T+znzMUVp3AMgAW2b8aO4tKrLfAiNjua6gD0ogq30vmYwZrNpTO0tP7QAnkfgFwkLSFzlbiv0MafZHDIyWofNRhue5bbcrD+1EpW23jUGzBCkd0ZUHF44O1zg6ThL0ISqUoM6FsBI7Bkv58Xz0VWIOAEBSFsjBUuxjSsuMS+kHSX8fnzw09UhMaTaVdQdiROIXCAdJX2QrkHKZFwH0AT+6FndJq1NCSd6E6MF3g0WxIBniRuXoOA+sgv9Z227vxWDf6zdcFcWC+1fYqoP/v7LoRKaYTAR0ck5EzJ30Xc98fPRDqeWM6Wpf6/EwMaXw1J7aIaaE4JD4BcJA0hdZ070vrMtlfiThFJSlhzbujFa0xsJiBSHnoBuVo+OwivRttdivKNj5jftXmLSKiI99xABATuwbnnNCbB358dFPzhMb0LkV+7H5pxPXYfjnIxn7V9tuqSiBIJH4BeyR9AXCmB23oiSPPX1QmjtIvpEwPnMhawzaJHE1kV7DPjo6HEnfN+iKgqVxN/attKw3wnLsd2IdkASQn9K6A1b0fj0ngv1AAALagoWYUgCKYlGLn5jScuY2gEkSSPyurTsATJF70re07gDsablM7+VkD1yIyMq4D/AzcK4pW3uaBsl8DwwvWLE4WeXoOJR2PqNtt7cSTpnnCyHIFKLqyNdIECAJTDSJCr+r+aytOwCgo/uqWo/NL4VEYAiWHtogpoQoRJ74XVt3AJiCpC/QuRH7FTAfdVYgDOgq37n34HvQSQY4b2XQZm3QZkpqR8dZOTpO6mqxv2/tXAmrs0PDJBakjEkm8WAv8ZlQ1hMITm3dAWHrFVOeVvkSU0JUIk/8AtHKPekLiEhQ5TJvWb1gZjnz8TcSxoNgLFYGbX7UfTAxkMPSzhseYvvR+1Zt3I19H4pisbLuBE5uVdB47QiAnFRv/UPm+0zOtfLPekUhgAM6Nv/Duh/SVeAprTuRqeXMx3+RsJ7/gF5I/ALzK4rF+6JY3BfFoimKxTVJX0AFUi6TMpkGdDbs3Kt8KcEzgP6sLMqu1wZtpqB2dJxbR8fJgibI76z7secTid8g1NYdAIA9lXUHEtRYdwDAz9p2uxT7pMaFUIHHO0+rfIkpIVokfoHZ3Uu3GOeDiKxI+gI/qsW+XOaVkPjwbe6f91+sXhxlZdDmDZMuRrlxdJyVo+Nko223tYT14ETi15Bevz698c+Nx64AwE5l3QFDc00qbWY6LoDpriWAmBLjcX90/D13TOmPtt02M7cBzIrEb96MKptWBm16pz/b/YlHFyR9/ausO4C3BVQu81NRLFwlUXBCUSyWMu+MzOe23fK7HEET5S+em70QdwnMLDic1Xyn12AMV4l9cGkfiV87XL+AeVTWHYjY3NV0crMh8A+ES59nQhiPfdLnNMxvKV0cYS6Puooc57mawF86Og4OkPjNGgts5vNTQp2kL3AgoHKZfzJIn5fudfNlxiY20s30xXgWq95Z7TvMMrDjZGfvwSkkJH490+vWm0HGzJMEXNOBeZ08x3QrlazMuKcm1YPAPS1wbbtdic1WRYe+Zr6v+ux0ddVvMzZBTGmYK0fHKR0dB0eQ+AWcKw+/QNIXOO5Gwrj53BqVP8jFaubjX7NycbKV+F/ByGrfnhyu8n3kXJmmbbdPIvLZuh8HSPz6dSNvrzIIaSW4BVcBoN6YPITMnHteyTFgXc50XJK+YbG41hMfiEMtYcSU7okpzWo18/Er9vFFikj8Ak5Vh18g6QscoTefEPZiuRCRhkG6e1rWec5yc58zX1XlhJ6LFqt9v8y4QiMlS0fHqR0dJ2u6qoDEb4bOrfIVkSdffcF3jN2AVzkmfasZjrnRqlQIB9d6HKXPsbUQU0qWxpTmnFj4WSf2Akki8Qs481N+I/ekb2XdAYRLV52FEKBgkO6Y/iznLOt8p8kXuHErNg/LK4M2o+FwP2z28nVIrz0hbFGw71NRLJ5Y+TirWzm9l9jaUz8AHyrrDmCwiwy3rZnjOZKELxARTdjV1v0QYkrOadnsOWNKfxBTQg5I/ALTvHVvzz3pC5ykKzVDWDXFIN0RTTrMGTC5a9ttPePxs2O42vdDUSwo83yEw4kTG2EvX+f0GhRa4vdKRJ64j7mnQadPZ162nr0jAHBabd0BX/R5Y47VX8sZjglgRro6/3frfggxJWc8xZSWMx4fCAqJX8xozgqfoaiOfZGkr3+ldQcwTECrphiku3EvblYnHvNMwnc2tyLyYtDun5xzP9KH3JWjw92yyncegSZ+L6W7j9XWHUnFgPOxmbcnQPJK6w4k4INOUslBPcMxHxkzAXFq2+2thDEuJ6Y0kY69GzldYWeKB2JKQeAc8YzEbxYq6w4k6lh1oReSvv6V1h3AcAEFzxmkT6D7Ss41y+dZuIHNRgeAVqtu7ylL+4NbcbN65ZkZzPMK6N6170JEvhbFwmL1fopW0m8i07eZ+xEs9meHI3NNGExF32eT5ZydCMgcY9blDMdEnErrDmC4gMblxJSmcfUsfMyzZFQVI3BzJfVxAolfzCHl+53Gqo/lOda5J30J4qM3HaQ/WPdDusHHP6yUGkYTDOfKX471LCKVDlAwEy2N9WjQ9KWwSk5ERPS64+o8qh0dBycEFGA69Jvu85vsAHxuWn7+Y5/X6p5yuSqN2q2M2s0Bz3Dh6RscTX61r46VXE8SeNRthxAei7KBpUGbcONGwkhm7BK/tXVHYqKLCIgpATMKKPHLuZiO0roDM6rf+ofck75zzc5Cumqxv/HssFKqJ32Y+W2mwzM496uWbh9Y3670IS9beh59dXS4PzJPQnmlid8Q9hI7dCXdJCb2zh5Iz8c/e748lHEL4AqTReK2su7AzJYzHJP7JJCAgJIZIq/Vd5bWHYkBCd/wuZ5MzORkO4FcK4lXpaOy7sCM3npGeMo96WuhtO4AxgvkxrPvt6JYNJSefZsmE1wlqg4xOPdM9zJbGjX/KdfEr+OE7yNlnf3TvcQ+W/fjDX/qvYwH6x5GnI/reXoC5IVS4c5cpppk0OcO16t8/2KiHJCOAGNKX4piwXZGJ5DwjYbrzzDnhKEAr5WYrsqs3VmdqS70jaSvf+wHFbm9G49FmdljPojIOvVSaWPo4LzvSqihHoTBuQlNXlmVWs8u8es44bsRkWtHx8JAbbtdicgvYrNa/pwP0q36XRJ0etvI8zH3ZEFl1G5p1C7mU1p3ICFfUpvoo5MClo4Pu5nhmHDEcCJIUudOjgJMZnwUEbZdOWLmhO9d227fE1MKVmndgdwFeK1EnK5Sm7yrMbPliZfkm/QlQYYp2nb7rW23lYSzT+KFiPxNuedOUSzeeRicXzM4N1WLyItR259yWWHvOOErwkQJc7pa6L2E++D0RbqgU23dkdBMqFyRe9LXSmndgYRZ7KEJ91IbS62k/97GfdWMm4JWGrXr+nMGA3vJDKvJzIcuRSdgWnckBBpTupd5Y0r1TMeGG6V1B0DiF84srTvg2FJOLyylvLMFZs+lQwdpoSR+Rbpyz1mv+tXZO43MNzj/g8G5PR34XYvdisUP0gUrk72e68QJlwnfz5QnDIOWSa8krPvXvkvp9hh7yvl+trM3kWls5Yrcz7uUkkqwlew938iFJJL41Ym3ricj3LXt9t7xMZGIFM4bfF9McC1hjcm/6Bg823uefu+NdCug5/CZmNIsKsfHy/YcCA2J32RYTtz9lMpqX10g8du51+Wc9C0N22aAnhAdrP1u3Y89l9Kt+l3l9jBYFItr6YLbVzMcfiPd4Hw5w7ExgiYQ39q03ocr6YKVSZUrLorF+6JYPInbiROftbQwAqFBplq6fX5DLPcs0p1jf+vK+sq4Lyb0+550PmqSP2dWARsCRTMwfljPalztyZV0K2Sj1TfwMtCz2I5x0U9l2Db3mITomPwP637suZJu1e9thjGlWrqE71wxpV95Lo5Gad0BvCLxCwei37++bzXGtt02JH3zaxsz0D1Gf5WwAuefpNvrd2ndkbntld75r8xT7upFurK0qxmOjQn0d/LZsAsXIvLfVB6ItXxsI24fcu84d8Klv5tKwn54+iCvyd/aujM+6H3tVkT+ltNle855dNSlmJVG7VJ+cx5lpm2n7GOs22bMsA2GSPc8SVlnIDM6uTy0yZi/SRdTSn4Syl5M6avMM4Z7li6mRAWH+ZSOjzdH4h8TkPiNVyCT+K9EJNrYreZ3ej93kPTNr23MRAdvlYR187mQrjzPOtVAuX5fa5mv9M6DiLynLG24NGn1l3E3fpNuH9LKuB+jFMWi0tW9f4rbh1z2KopA226f2nb7XuzPo3M+SFf2eV0Ui5tYB+unaMBpKd19zcXKMe5d05Lmk+RcGnFGlWHbpWHbwXI09tltmxHNdX1o4GWAmueOaFSZto2Z7E3GfLHtyQ8uROTPxGNKNzJvTOlOuoQv1/Z5la4PGGt8J2UkfqNVWndAfZLIturbi9d+6fmWRxGSvlai+WBhGB3EVRLWniwir/sjJhMo14teI/PNxNyIyO9tu71mpn342nZ7I/bn3a60+n0se0UUxaLUvUL/FvczWdmrKDJ6Hv1Hwgo0HXMp3QSF/6fnW/Ql1vVcvJUu4PRF3N3Xsg4uBRCoKY3bT1Fp2DbPcPO6km5FWWXcj5P29lnvG3gZ4jOrwKJi+UxdGraNGWlM6b10k89Dsh9TqhOKKc0x8Xlnt0UY1Rv8mGOcVs1wTExE4jdKpXUH9uy2MFiFnPwtisW15j1GxWtzTvpabh4d7AcK0wW+T+IuUL7WcrSlcX8G20v2/i3znce70ju3Mx0fMwhoL6SPIvI/HUCU1p05Rs+jlYj8T9zu3bvDHr6RatttI904JYRzqY+P0pVY/6bnXDQJYE303miw6X/Srex1HXDKOukr9mPuyrj9FFn+Ti9Cva8n5EK6CXRBll5zsc/6CYyd4mNZ+tP6/oYZaUzpWkR+lzBjSl8lnZjSXOfxs3QV41YzHR979HM4R+I+mmfL3JD4jU5l3YEjPkmX/H0qisXSeuJpUSze66Sq+6JYfJNuC8sxeY9GRKRo29Zl/6KgWfx/jLvx77bdro37gJnpwGMltpMMznkWkVsRuQ959qGWErqR+R+u/9D9dBCpmfZXm+JBRG41mWZGg6fXMu95tBFKVyVDx0u3EvY97C0P0g12m1A+jzomeC/dA08l89/PNm27DS5p4pNObpkjOdPXs5ZOhwN6H/t/xt0gMXdAAyR/z3DoFxFZhvDz1s/ercx3PeFzFZkZP/dD/F/Iz+9wQ8fjKwl7f9FH6foYbEzJ07PwDjElz2aOARG/D5ie2424P6//Yx3DS4kmMeeYmDGHF+kqsD2JyDf9cxhTeup7v9M4ULn3pXfyOnnvvf6/y5jb7227vc016Xsj3WpHS7+zijAf+plbSvgXuF2Q/D6EQY0+4NxINzif+2f3KCI3oSQHMI2u9ltJWOfci4jci8jK1+ds7+H2Wubbo2jnWUSuQ7h2wC19iF6K4d6oDjxKd39bi8h6zge4vRmilbwO6N+L/+vRg64SyVZRLNZi/7klUOSI3tv/a9yN7M+rQx6SX2bJXw3S1NI9j8x1DSfhGyHdkuE3427w2cmI7iM+R1l51x6ke+ZtQhj/6Nhh98dHTKkO4fvOzcwTPUniB26mxC9JX0cCmSiXk/+07bbJNen7JPaz5F7adlsa9wEeRbLqd9+L6Cop8TRg159RpX98DMpFupWJSyZhpEcnDdyLfcD/mI28nl9PMmCW2Cn6Pe/+VOLvXncn3aSJIGd2Yzp9kLqReQPfvm3kdcbmWv/0VR38v0VS95ysJxgGUtlHhECRMwGs3N4hkb/HYyBnI92z1OyT5/aSBHN+3jbSjZ1WM7aBmQQyqYhqEpkhpnSeYUyJ67kRfU5dy3y/642IlMQ6wjZD4pekryOBTJTLyb/bdrvOLukb2OyCrINxudIgwq3YPyQOtQuO78obNCLybWzQRYOx76QbjO+SVL5/Jn9Jl/Bl8JYoHfitZP5Vri7szrFjpUOavb/vzh2R11WE78RmMtNGutnM9wZtw0Ciyd9U/ZJz9YqAEoQb6fZ0W1t3JGaBlHbeYbXvHqPn610i4V66iXPrKQczSBKwHUbEAosp/co4PD8RV+HZjymt9b+xx5T+kG4rJ2JKRjxV8/yrbbc3M7eBiRwnfkn6OuBhUgYOtO22EMlwT9+iWDQSzqw4HvYypuV5Ugqa72renxPC+fcg3UzMtXVH4EdEJdZjQvmqjJH8DV7W+/kGtMp357Ftt5V1J2IW4AxxyqqqQBLyh5NTj02g2yn1j1X5/UfptsMgQRCpQCrH7TCxKFOJjsVjiindSbeAYG3dkZx5TigxySYCDhO//8dYbbqItiZIxfe4Q1ZJ30A/aCR+M5boQD1kj9INzBvrjsC/CMthhYqS6Phu7z5WS3yrDVJ217bb2roTFmba08mFB+kmyhA8GCiQvXyPIfGrimKRT1BhGsq9Ry6gKhL7XqSbSEBMKUM67llKWBOjUsbE50AYjPmpchYJF5+N3WpJjBfgROwcfI8DLYw74kVRLN7p7PDQEr4iXaLvn6JYrDQhgYy07fabPviX0pWF2Zh2KF0P0pXmqEj45qttt2ud8fSrdMERDHcn3X42JHwhIq/3sbbdliLyWbpACOxleY7qWLqR8BK+It02A+uiWNQaiEAPWqkjxISviMjXolg0Wuo1d1z7T3uWruT+0rojGEdjSisJL+Er0k26+6coFktiSvnRsfiNiPxbumc1YkrzuJNun8SKhK89HXv5rrpwISL/1fg9+6kHTCfZVtKNv2BAJ+021v3I0PcJgMmu9NWkknQhAAAgAElEQVQbwK5ck499eVx5loP9LURkzaAiD6yYcmoj3T5flNzBT1hlPxir5NGbPgTfSFzjr5Rks9+oXsvfy+tebjHs377zKK8Pwo2ICNfY79eP/We4WMbDL/LjPoVrmbBPYWwCXo1tjeooEUsspvREpYk88JzrFDGlQAQ6PnyRbgzfSBe3byw7g59NWfHLSt9h9BwtpXsuD+UczdEvu+fPKJO+Oviu5HU/nn2+9+Tx7Vm6QfuhRr++YjCfhqJY1NIlfylFO8yLdCucOBdwFg/FZ71It/81JYwwit7LriWuZFzMnqXbNiT6+59en6+lG+u/l27/zX0pj492+5Me2u1T+hTjdVlXoNXyupfqvlLSDg68tU/hLiGzij2grNf7r9b9CMhf0iUKor8ep4iY0psxpbWI3PO5TYNel28kzAooISOm5MmZa7FIfNfjc2N44vae6TPlrQys1EHS91Xmz3AxedEKfCISYdKXh8mzntt2S5mJhOjFdbf6N6bBjk+7GZgrZtdhDFbZ/+RRuvNpZd0RpGEvgUcCeB4bEblNqXRoUSzuhc/KKVHtDarj2f9Z9yNgGxF5n0Di9710e0vmfO7eCavCgqZl4/+07kfAiCklRq/NtRBTOmUXU7rNpUqHtYyrhHCNNTB0iwaSvh2N46yFe0cM/tLtHkQkzj19S+sOBI4ZfInRfUhv2nb7Trq9SNmn5dWDiHxu2+27tt3WJHwxFvuSfncnr/tfr6w7g3ToObbSssP/J6/3M/bXnuZFRP6Qbq/tpXFfXGPf29Mq6w4MVFp3IHAXksDPqG23T3qd/7d0K11zeWbZSHct/rc+k6yN+4PTuL+cRkwpMXptJqb0s410P4tf92JKJHz9yTXxyTXWQNtua+nOdwwT22r7XG2kW9H+XYwrfd9LV3aGD9xxd3ohQ+J0VlwledXK3+2ZcR9jWUPERVclXUs3IzrlgfmziKyEMkMwomO7au8PY7zTXqRbiXCf8mSnolgsReSLdT8C9mtMY6Epe2plIpnS7IcSL/P/IN21eGXdEfSn5UTvhfHGW35YKYJ0aUxpF1cipgSv9Fr8t3E3LHCNNdRzxe8PZXJzVxSLJ+EZLnSfD59Hokv6ivwQiH8nP89y39XJ76M59Y9jAmka0Dg3W6nPa4a8Z61/mpSDf3jb3jlRSVoB841052kj3eebWZcwcXCOpRC03CV6Oa8QnL0k8Hv9k/sDxi449SRdgGpt2huP9LOwG/MfjoPXcnyP1EPnng3WY36mel8oz7ysz2sOHdu/eOdJXvdbXA88bhA0AVjK8e9zt9fZOede9zQmearBx3P6vGbfqWe4qPdoHuqgzH8l8T6vPMrrxJu1cV8wkqeY0rcx42zjmNI9zwZ5SngSJjGlgJ25Fu80PQ939HXn4uRnrrml9B/LnxrD7/rANTYAPRK/j227rfz0Jg46SWgXn9l9zk+Nl/o81416ZnuL3sfeOgdLeXvf8HMVYEoJd2LUg3TbEjSH/xBl0hfAaXqh2//zwbZHvT2LBr+EATkCpoHh3Z8Yyp3skkaNdOfW2rIzwFB6zr2X12RRDOfdGI+yN5lPHD8IAUAoIhpLPcuPYyiuyQCStxdTqqQbf8cWU2qkG0cTUwLwE52IeivHx5+/t+329sjXgZN6TiJ24ezEdZK+QCZ00F7Ka9B893eLAMujvM4IWguDcUROZ6juT7R4J3YPxs+i55WQNELC9mZl7/5b6p93Eu7q4N1+4evDP0zGAJCzg2eVSmyu5fvPKI0whgKA7w6u0/tjcOuY0pN0Y2liSgB60zjerfxYzS/ZLVeQF5K+AA5LIFR7/1TK8LKEh+Udvpd0oPw4crQ30+uwbFCfMiLHHJ5jjf6XwCRw4KAE77HSXWPPw33HShc1+//OuQkA4xyUXdy/Zo8pbyvy4/V593eu0wAwgaeY0qiS6QBwykHMgDEhkkDSFwAAAAAAAAAAAAAitrDuAAAAAAAAAAAAAABgPJK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQMZK+AAAAAAAAAAAAABAxkr4AAAAAAAAAAAAAEDGSvgAAAAAAAAAAAAAQsX9ZdwAAkKeiWFT61/ci8k7//k7//5y1/tn5JiJP+ventt1+m9xBALMrisU7EVnp/9YxnLtFsbgWkRsRuReRVQx9BgC4URSLUkRK+XnMuvv6Oc0b//+tbbdPAkSmKBa7Z7n9Z7r9vx/zJN3z2/7f1227Xc/UTQAAgGwUbdta9wEAkDANBBz+ufDQ9Iu8JofX0gUU1lYBtb0gofeg3l7b0rbbxmfbVvYCUNEFkPZ+X/vnzDsReZ9agrEoFo2IfND/fWzbbWXXm36KYrEWkcu9Lz1Id335IYCZ2u/qLXuf11JeP68fROT3tt3eOm7Dy/m8196g36NOYtglgbxde3z/fPram9zltF+777fv/Syx+0Gl/5Tc/SBE+hne/exLeb1fze1R/7u7rzQSeFL44Prn9R5o2XZu9s6JSrpz4mqGZh7l9dmtCflzf47V89/uvuf7uW//XJyzbf0cOv+ZzjVuGdF+0Nd7AED4SPoCAJzSh9tKRK71vz4SvEM9ymuSZj3zQ+m1iPx35Nuf5TWJdEwpPyafxtq1s5bXIMtTbMFxEZGiWNyKyG8TDvF4/iWz6DMZ4j8pJe01sPH3wZd/bdvtvf/e9KPXt/+NeOtuEkoq3sn5QO/kJH5RLFYi8mng2zbyWvnhmFKGXTc30iXY1m+9QK/zKxl3v3PdXxGRh7bdXo/oy2QjfxbHzo9S+n3fz227PVohhPsBhtJr/G78+tG0M297Fh2/SgDJYP2ZPcm469+5e2Ofe00f+9fZRtt8Iqly3sFzndU5sZHu93YvIvcxJPWLYlGLyNeRbz93XgydQL0RkWrOz/uE68Cx73Xo5Jq7tt3WA9/zg6JY3Mv4z3efsYKLCUO75/Xd9f+JcQAA4C2UdwYATKazemv9M8eMb9c+yN7DV1EsRH5cGXzr8MG4nPBeXz/LXTs/PJAWxeJFNMgSciLuQDnx/b5W8QyW4IP98sjXdmWTQ9Wn/Pwxl+JmgkZuTpWGfMuFuD2P+wQw3/V83VvHd33dKR0fb2jbQ38WU86PU5+RcuQxd7gfZCDCMeyVvPbzi8hP41iRLimwiiCp6eveuH+d3R//R5dM9EHPiWvpzokQroMX0iXkPorI16JYPEj4v7Mx45cd1+eFrwnYY9px8b1O+Vm74Osc+el5Xa/9j/J6Pqw99QUAEDhW+gIARtOVerUMX4kVOqdlZg/Kzu3sSqNVEuZq6EMb6VZv3Yb+QLlfznpPJd3PPNSVO+e8tO22tO6EK1p27p83/jnYFWwOVg7mxMl19Mj5XMk85/JGuqDZrgrETq9SoUf6uSsJey3zXeN31+VGXqtCmJcEPHLPK/X/axn/s9j9fhp5TWyd/V5P3A8qCSOZMUZS9wMreh+6kfTGsDuTV78NsVeWdKeU12tgLJOeHqQb5zbWHbGg18sbmXat9ml3X1iG+Gxy5nmkknl+xrstR5q9r3kreX7kOlCJu+/3WV7Hac7HPHtbQezsxjLXEseEIJEuAbxq2+3KuiMAAFskfQEAg+kD3VLiDZie421vUQ2O34iu1ojEnQQaYDlHAzC3El/yN4r9bvs6U7bXa6B6iIM9iHHarJ9ZDc6txE0g7k5EbuYKimrJ4xtx/9n5xTrBO4Te79YyPPD7l3T3HKe/H+4HecpgDLvzV9tub6w7ITK5BL6FR+muOY11R3zQa+FS4p4AEdWzid4Pl+JuIuGziFyH+v1P/H430n1vjcs+DaHnyL3Ek/x9EZE6l2sYAOBnJH0BAL1pkP1W3O1Ls5bXfWnWe//2fUbykVm31d5/S5ln9YD3gGpRLG5E5E+fbU60kW41xNK6I2NM3LvJQjDB26l6Jn7+L8SSfUWxYODc3+zX0TMrxvvytmrS8XU+ysTfiNXyn+descL9IA+Ox7C7UsqN/v/+yrO3VHv/dbVX7Sl/hDRGc3S99u1BusRJcOMRFxwkHnfbwKz1v0dLz+9Vf9j9d86VrrNO4nKtKBZLmT7xdyMiZQzf88jv99dQthkqisWTxJP4FUn8GgYAeBtJXwDAWY5mI7/I634zjYNuicgPgYRK3JVfMgmUFcViLeOT2Bt5LUt67MFu93NyvbLlUbrZ11E9TOqM7f9Z92OAoIK3UxTFohaRr2de9nvbbm89dKe3SAPWlrys2D6zaryP2ZOK+3p+/vsIdkX8KQN/X74+Q6VwP0iWjhNvZdp14vsYVhyWStVVx7sxrOuJByHeR1cy7fewP2H0mEq6n6fLZOJGRKqYqir0MWH19bO+b/L+oTquqsV9CfCNdKt+g/r8v6UoFt9k2mc2qolAA7/foLYz0Gv23xMO8SDd/Wh9eP7osUt5jWm4uo49S5f4TeoaBgA4jaQvAOAkfQBZyfiH8TvpVoR6edDQ4N61dEGEsQlOq6TvlP1Ce8+C1kDPtbgr4/YsXUAstsTvlNnaz9KVa+3rcMX6/tf6fE6TCfL3/LkHFeQRcZas260OO6c5+P9Sxp+vd0faLOXnfeaOKWX8td/LZ1avZ/+dcIh/+y6H6GhlT6wrffted19E5L3HfQhDuB+UPfsQXDIvVBPLCu/2zF55HMPuxmcuAv7/Ca2058SEyUPbbq97trPbh7MWN8nEZBK/+py0kuGTDGZ9ntPPRi1uS0w/SpfsWjs8pnMOJkMEd66fMvD7DS6hPTFJ37uSkT531OJmwnYy1zAAQD8kfQEAb5qYhDTfW2nCHlVeV37tTCj9+dy22/cj2nO5n/CoPliaGGRxWmpMg127AOWxQEJUAZ23DFwtG0w5N5Gzibpn6VaArXd/XF77JgbKnXx29HpayutKqnMBY19J30krsNt2WzjsTm+OSgQGWQb9LQNX1Ho9/yeWeOZ+EJgJiS0R3b5CugSXyfm1N4FxKeOTlsF9TvT7+n8j3z7qeqeJk6VMT/5GnzTR++W9DPtZeE2czrDX+ka6/gcznjzkYCJYbGOBpfT/foOb9FoUi0ZGJmLHjDkd7om+kW4y3XricQAAEVhYdwAAEJ6iWLzTgPSYhO+jdCunzGdWt+12raUh/y1dOaW+1rN06LyxgaRRD/ptu/2mD9K/SJe0muJKJwnEZD3hvU6DK227bXQmeynTfxchGzJbv56rEyNVR772IN317n3bbpdtu13p73Ltt2vz0+tpo9/ntYj8n4h8lm5FpmW/pgTgLc81FytXKgfH8KnXKj3pVjH7DtBP+RxxPwiIJrYaGZc0+kO6vTGXlkkUHZ+ttOKF+XXWlSk/07Hv1Umc70Xkr7FtqwsRWWniOjqa/P5H+id8N9JVFah8jml0rHEtIv8RN5/7CxH5ryYaQ9VMeXNMCV815H7bzNWJCbz+vHU8VMqwWMYxF9JN+gAAZICkLwDgBxosG7sC6Q/fwYE+9gIIv0oXxMCett0+6Srdu4mH+k1XKGEkDdxUkkiAd9/eyqW+PuqKj1AcrmS/a9vtdWjXO18OkhJ/WPdnJMukTiPdJKkphpxPIah7vm45Yx+ikfL9YC46Bmlk+Bj2WUR+sU72HrN3nf1dBoxhQ1vla0nvVzfSJdCnuJIIr086KXPI9hS7bVvMJnPq5JdSpifrd75ohR/YC+oaO4L31f56DbuW6c/qV4FPgAAAOELSFwDw3d7qiKEl0DbSlZFbuu6TSzpT9r2wcuYoXRU99WFyNb0nedOA8/Lgy7EHSETeLlV67j3mNGG93/dnPV8gInrtnxpMz9HUgHo0SV+dwNEnEfdIsuqV3g8OPydrg64ET1cy/i3D7zN3Wq0h6LK9moArZfpqL2tTJ7uMpqt+p96roprgqInOIZWbdgnfIM4HTda7mrT7icQvYuboWf0msEm1AIAZkPQFAIjIDwnfocGy3R5Xjes+zUFX5VUS5soZ88SePkxOCSheauA1BkEEtN7wQ/mtUIJvE40pZ+uiBK4Lh6t8Q+lXMDSYbhXMj7KCg05EmnIvuojoetv3nIltmwAfVvv/k2t1gVP0PBiyknHnc0wTePZWe/1u3ZdYOUr8Lqf3ZH6a4Pw04C27hK/588g+vVdW4ubZLbXEr9kkCthwkPi9kEiuYQCA8Uj6AgBcJHyjSkhpMONaAksUBPRzrGVaYGXpphuzCyqotU8/o8msSNdVMUMrCIiEk9TaT/rexTLJxcDKqN1Qrp1jrCa+P5bVvnWP17wY7OW70xi1e5beD0KcqBaEiQnfldve+KGrfqmuMJL+3qckTT6EvtpXSzpHn/Dd0WckV9WaUkv8Ij83Mu1c+BTr/uQAgH5I+gJA5nJL+O5ov5dv/HOU35MrGvCpJxzisigWsSQiQhZk4G2k2ui9ruwHRqySUjFYW3cgQlNXtoa29/VP9H7QZ4yxnLkrMVtbdyBEmnjLKuG742jFas5uZNpkitpRP5zTiRBDSjpvRKQONeG7s7fPuavEbyhVW4L+uRvjZ3OEngtTP7+1g64AAAJF0hcAMqYzPFcyPOErInITa8J3R1dK/BTwCT3o4YOuZJxSMoykrztRr/jV68yQ1SaHPgSU1Ho2XIkYg/1rZ9T3B1/0fjN1f7bQr7d1j9dshAkVfVDKU+mkxTGfmegTvjv6ffxh3Y8Y6bV3OeEQQV53R06EqGN5pnNcrenPEFZsx/Kzd2jd94UZ/mx602f1KePH2k1PAAAhIukLAHlbicjViPf9lUrATFhZdMpywnuDDIZFZhfoiH2Py9rBMaxXY9xKF1ivjPsRtIPgXAyTZ0IJJq4mvt/6/HiTTtj42OOl90y4Ommt/10Z9iEYEyYt3iU0fhURkbbdLoXy36PoZ2Hsz+4ihIThPj0vhk6EeIhtMpvua145OtyKMrd+sS+9U8sJ773isw8A6SLpCwCZ0pJWfQKxh14koUTpxIBP0nQG8dhVphe6CgfjLUXk1wQC1C4SUrWDY4zWtttvbbtdkpTq5S/pgsiNdUd6COL3qT+rKfehy9CSD3vqnq9bztiHFNyIyH8SuB+4civDJy2+SMATJCZaHvx/1BVCPJsysa5y1QlH7mXYRIiNRHpO6CSz3x0c6lKYTINIaQJ9ympfntUBIFEkfQEgQ5qM+3Pk24Pf82mEqGa4e7aa8N7SUR+ypInGqD+bmoi6dHCoC92jDoFr2+1N225Z6T/ccuL7awd9mEPd4zWPrPw5Te8HjXU/QqB7RI/ZMiDF8auIfJ/AuF/uNsnvcyZTxlnBJEx0Mu+HgW+7jfnaq9v0PDg41MeAJ04B50y5hlWuOgEACAtJXwDI09hZ7Y+JBh0b6w4ELIlgGMzUgR4LCM29TNuj8Dq0Mn2anOsz6SP2EvbwZK+s81CxVB+YIupJYlY06Tl2ZXQQ11w9L5YD37aRNK69tbjZ33fl4BiAdzpB2MU5AABICElfAMiMrpYbOhN8p3bXk6A01h0IlQbDKH+NwTQIOWY11ls+UDIcqdIViFOSNhcS3l7qdY/XvMRe0QBeLWX4Pr4ikZawHYjzaLyxP7sgkr7SJW+HnhdJ7KOu34OL8/uSijKIWDPyfTxXAUCiSPoCQEY0CTN2VvdDzCXATkkh6DGzxroDiNIcQfYcAvfI19RVV7WLTrig442PPV6awkozeFAUi1JEfhvx1rtUx68Hnqw7ELGxP7uh+0o7p2WJx0ywWzrtiCEtb/7o4FBLB8cALIy9hoUycQUA4BhJXwDIy42MWyEhkn5g1kWwIFVr6w4gSvUMxwyuhC3gSttun2TaveiDJsZCUPd4zUYoqYn+ViPfl/r4VUS+V2bBOOuR7wuhEs5yxHueE/y8LB0cg9W+iFXj+X0AgMCR9AWATGiiZOwquZcM9kLbIfn7M1aPYJAee3k+ishfIw4dYglbwKXVxPfXDvrgQp/xRhLlRTE/Xc04ZmuSZ51MkYsH6w7EaMJnZO2yH0NNOC9WTjsSAH1OZbUvcsVYCgDwA5K+AJCPWljle8ou4NNYdiJQPEhiqPrMv9/K+OsKJZ6RLC1TuZlwiNpNT8bTRMSpSR87y1k7gpSMve6vXHYiAjfSXT8a437Aj7HnRar7Py8dHONS72FANDKb3AQA6IGkLwDkY0qiJNXgwHdtu70RkV/adru07ktCGusOwD8tL3tqL89N227vtbTg84gmropi8X5M34BIrCa8N4SAdd3jNQ8JlhfFDHrcU05Jfvy6r22367bdvmMsO8qYVaJr153oa8J5kWJpZxH5vtp3zLjyUO3gGEAMSBYDQKJI+gJABnqUWj3lJdXgwCFmyb5p7fl9iFt95t9Xe39ntS/ws6nVNWoXnRhDt5L41OOlOVQQgRtjr/fJJrcQDMvnhrHnReOyEwFycW9hGxHkYm3dAQDAPEj6AkAepjy8ZrVKAkeNKe+8IdiarfrMv6/2/j72+nKtySUgOXrtnLI35yfD86Pu8ZpHXZEF9FGPfF/jsA/AMZZJ33rk+xqHfQjRvUzbIkFE5EInTANJY8I7AKSLpC8A5GHKg2vjqhOI1phSuo3rTiB8PaoKPO8HGNp2+03GJbcuhJUYSNtq4vutzo8+q89Wc3cCadB7ysXItzcOuwIc2lhNXpl4XiSd5NFxpYsJy5WDYwAhG1PSHgAQCZK+AJC4iYEBkcSDA5gNK8TzVJ/591XPr/VBiWckq2239yLyMuEQ3s8P3Uv43FYSL227Xc3eGaRiyuQFxq8Yohz4+maGPvQ19rzIpQqPi2cQJhYidY11BwAA8yHpCwDpm/LQmktwAG5thKRvdopiUYrIxzMvWx1+QZNbY0rxXWmSCUjVlL0Jr/Sc9Knu8ZrlzH1AWkaPYRm/YqBzE1YOreboRE9jz4ssJkLouHKqS7YRQSyKYjGmKhfP6gCQMJK+AJC+asJ7swgO4KyhD5L3Wl4NeanP/PvDic/F2MDDuTaBmK0mvt/bal8Njn868zImBKE3DWKPrVRD2UrM6cVRYnEwnew29rxYO+tI+FxcAyoHxwB8KAe+/oX9fAEgbSR9ASBhuspn6Mz1fTwMQERk6Ez35RydQPDOJZhWJ/5t7IrGT6zEQKp0ksTdhEP4LE9Z93jNLROCMEA14b1rR31ABkZUDVm570Vv1YT3rh31IQYukvJjVk8CFqqBr59SSQYAEAGSvgCQtqkPqwRnITLsQfKOkor5KYpFLadXnmxOrYrR2eZj9y+tR74PiMFqwnsvi2LhK/HbZ1Xxau5OICnVhPeuHfUBeRjyvLQR24RJNeG9a0d9iIGLicskfRGLIWO9jTAeA4DkkfQFgLRNfVhlpS9E+n+ONsIqX6cM9uQcqz7z76sexxgbRPVWwhbwrW23jYg8TzjE7ElfXSV3rqoIE4ImGrlnX8wq6w4gG0POrRvjigVTrgNrV50Ind47pyodHAOYlY4NhlR2o+oKAGSApC8ApK2a+H4eCDI3cE+9W4L67hTFYiUi//O4Um8UTUx/OPOyVY9DjS3FdzmiNCMQkymrynyUQK97vGY5cx+SpveDf0K/H7iin9mx+5aKiDSOuoI8VD1f99i229WM/ThJx1tTzovcTJkwJSJy5aQXwLyGTH61rlQAAPDkX9YdAIAxBgT430n/GdHvpf/epT8lONp2W/R8r0+ldQcQvbrn657bdrucsR/Z0GB3I/EEm84FG561fPNJbbtdF8XiUc4nkI+phSA/0nUvXZBubLC/lpmCfHq9+nTmZY9MCBpHkzz3Es/9wJXcVjXDyIBVchuxryzCeTHMk+R37URGdAw2ZDJYHfoq36JYLEXky8GXn6X/YoSm5+vW0r/6wVPoPzcAOETSF8B3Glgqe768b4J0SNK1lGGlaXDepJ+no9JYiFufB8lNz9elZCmOSk/uTWJ5r8f8ePCS0B8y6zP/vhpwrJWMS/p+KoqFdclFYBZtu/1WFIt7OZ9cfUst863sqHu8ZjlT26FYCvcD10rrDiAbfRO5yz4T2GY2Kemb4XPdeuoBimLxPoDfO/CWpfSfEPjQttuxVZWsDZm8MeY58qyi6F0o9bHn69YyIOks/cZ/37heAdgh6Qt4MGBVainuk64iMw18ELaI9gJFoIpiUUu/iQN1hqu4PhTFovXUVrAPb/oZORdsWA045L2IfB3ZnVooWYZ0LWV80vdqxsB1n5X+zQzthsTb/SCDn+VOad0BpG/AKrm7tt2GML6Yu1R/alzc8/iZI0hapeC3ni9/kf7VuzBN39irdXL6RfonnZuer/sm/a+76wzjR4BXJH0RrYGrUquerxtaCpg9dRCy0roDiN6yx2v+iHjWcBQCX71an/n3hyH91xWNdzIuuXUjJH2RqInlz0W6c9VpaVKd1HhuYhDnJMYg0QIfbuT88/yz2Jd13qG88zAhj5+B0XTCyqrny7FUYsoAAB3NSURBVDcich348yT8u5T+VQGtE9R9V08PSTr3XT2d04RLJIakL36gg4chpXjLnq+ter7unbDvCgCY0/10zj0I3LGP7+yerTvwFp18de4hcDXi0GPL2F4WxeKaSQhI2EoCSvrK+UkfL227XTluM2d9g14pILmFWekqucN9Iw89i0hFsiRaa+sOADNZSb+46Ua6a1iwVaOAHoY8+xxuizLZTKune5fsFlZPYySSvp7oQ0XfGctVz9eVMqwUMKtSAQBn9QyE3bXttvbQndyFHGhcnvn3zZgEbNtu74tisZFx45ZauqQxkJy23a6KYnEr486NC5eTInSi6LnJGSsXbQGASz1Xye2SJSGPw3CCVsiw7gbgVFEsVtIvsUXCF/ArptXTzzJD0ll6Jr1ZPe1H1EnfgatS50q69j2hAQAIniZ8mzMvI+HrT5DBxp774K0mNLGS/vtU7ftYFIuSWa5I2K2cn5TzllrcTYqoz/z7Rijt7NraugNAIm7l9Cq5UBO+swSJAYRPn71upV81pGcRqUn4AnjDkAqrlqunNzJDyW4ZsE91zNfRo0nfAatS5yoFzGAWAADP9hK+p1aRkfD1K9RB5rWcX224mnD8lYxL+op0yajlhLaBkK1kfNLX5aSIc6Wi7wNMmMRubd0BIGZ7K3xPBTCfpdv/cu2jTz4VxeId12UgPvqMvpJ+iZoH6RK+nOsAYnch/XOEQ3KJvZ+lZ1g9LdI/6byWASXDD6/7PyV9dX+2PgnfUtjPFQCAELwvisX7KbPQimJxI12ijIRvP49tu61OvUDHVOWJl1T675XEVznkXMLnecrnsW23T0WxeJZx48JaSPoiUVqu8kHGz7q+lokrcItiUcn5a9ZyShuRyf1+EKK+Fb5MFMXiWvrvsd1MaKqU05+7+7bdRrEivygWy7bdLie8v5LzK3xT38O3TzUfAIHQiSpL6TcR9kVEblxt4wEAGORK+u/rXEm/lcmldM80feJq5eHrfkr66ozGdY+DmZppj9yh5aLZIxdA0qYmEuHNhYj88//bu9vrto1tDcDvYJ3/cgfiqUBOBeapwOpASAVWKjBdQZgKDFUQqoJAFViqIFQF12qAuD+wYcG0SAxmNjAfeJ+1spzEBDgSvgazZ++RIFmN9jn+iDPlSHpLJLxHO/A4NMj8RyoDgzPZDH3Aok9Vd/8iA8BbJDDYL32woWBspfBVFYA/Hba71Fy7lChCFdyDvrfwL7tcDvz9Q45Zcmdshj4w8nlQyj6jfx5E7D3iXt/9FtNkLoy1Qjpl2D/LBMUabR+3Bs6vCyeB3hXae9bQ7/EBbYZvrgHfpXoAKwlSQuQdfY12kp5NKeduOY0t719ElKkHy8+NWYPYuhx0qmsQJ7um78ggRD1VO2zIy4aNFeyzp8eU4Gb2NBG5ijpTgn5xhaN7/ohyJKe8oC0RFfPgafKa5rAzpqjR9ln6x3Afoj0DbLKTKoXv2cEt6Avorl1KFBW5XzzDLSh46TOhSwYjhwYhNy77plbTHCpjih1+fR5wEl4+btEO6HdWvX+mDPZ3GQg12oGuasLvmsIF2gkvHyGl+RT6uUA6lWxcK6B0+F43HoNoNJleyfk1xicVPaEN9nI5DSJyYZuVCtgHSMcEXfcLmyQ8u2SDvilJZUaARdmxvrXl55g9TRTOXmEfHBwggAPNs2iaw3fJYvmn97/3gZrzJhmcuB742L3G4INnGVvNtUuJYrSF+6SIWwxn654ytN1zKu8+MTvxPOCgrr116AacI5MuTlVi6Sqw2GR42foCoOIz8aQ6dAMs+d4DYs+An8LKZ2NWvKKJrTDuPecB7TW84/2cKFrMSqUoMOhLP4ws7V1P1hALzJ4mGiYBE9/dLHFwgH52AWBnTJHzGmfRaJpD7bGW7RyuMTxBq1L8vh38ytjarplIlJoK7kHfoYkb55QDf7/x2Df1JPA8mNIefiVZk520KEGm0phiC+Cbwi5/b5pDpbCfnG2NKR4XEOBL9rrwwDL5FK2mOTwaU/yGtm91nCxTy5+PaDPicr8/EZ0zJiu1tvwcs1Ipawz6UpJSmbkyMnt6TNDZNnt6Bb7okJ9V6AZQFK7QZpWVgduxFDXiHeQfCqK+KJcC36E991wqgZRg0JcyJZmgd3DLBrwwpijHBoIs1vN+YXBJXY14nwdT2ntun/zvTIIBXyBljB098Zq00k1wfB/5BMc9/CZD2I4hUMs2W4vImQRz+b5Codje5/aYoBQwJzMQTYdBX6IJZZo9PbZkt+2MYp8XWDrtARwcIB03kgWxDd2QBei/JEXzImQR8AGU1weUwNYOMwa2iBKyhXsJ2GuMv16HBiX5fND343mQyqTXWEiFkjp0OzxV8Av6VjrNWIRLtBPN1oHbcc7ec/uVQhuWJOYJAEQUr9BZqY+RT2Aiohkw6EtEAEYPJAUr98vs6dF8O3vJZ0osyD1+fhFYn/jcCu7n8J/GFDVnZE7ux+83shc2m1no9QTfW8M9sFWCg96UKckEdC3/O2rda8v1vCuHdtB5S33e1vALdgJt3772bklAslTLM9z7bTmdP0/4+R301Huez1JMH4wptk1ziDXrzvd4XhpTvIusbxmznK4fohwwK5WIyBKDvkSUlJSypyPxCPf1MAFkkymRu6emOViv0SiZ/Vu4DYrVEijggNF0ovvdSsDHJvC6NabQHiz1qTjwYUxgiyhBWwBfHbctYb8G79B63ne8ziYR3fNgJho/9xp5ZJ/v4R703es1I7i1bd9TJglv4DZh7JNUtqkctp3aXmEfyU+GsCXngQ8GeIhm1jSHDez7pkREdAKDvkREeavhnymxxkIGBxI2anC0aQ61BH73GL9W6gXa84Glvycix+cOcZXhKy0/d4n4qiHcgmtlUb58173eWH6WpZ0D6D0PbJdLyYJksfvuZq3QlKTlNBFjzGRD+blLmbDmMvl1K4HfqIJ+itdF7d2YNKw8t4/q+OdCloux8TJpQ4iIiDLm3WMkIqKoabysWmeQUjpk8Mz12F4ZU1SKzaEjTXMom+awDt2OnpSDpt3AL1F25F5eOW5+KROAzrJYz/shtuBITuR5sMS+mG0Zx1MuRgQXKE8l2rUVx7oAUEXad/C9LtYajViA55wmTUTG9rpiv4KIiMgRg75ERBmTweAnz91cKZTHoghJ2e4vjpvfGFOUeq2hWElQKLbs3TEuwMkrlDefLNvS4jNDkz4qj+8nOkVjwL9U2AclyneCI+K8t/leFx9UWpGGtce2tVIbpsaJLURERPQLBn2JiPJXK+yDAZNMybo5rhMDvjKLZhHK0A1QkHKmMtFZko3kmv11fS6bTf7uXB/gOdK1Lyl9tcI+2H9dOKlC4DrB8aMxxUaxORpq3x0YUyzluvDJ1N6ptcKOS0Y64La0AxEREWWOQV8iovzVCvsoFfZB8bqG+7pJdaTl70iBHNub0O1QcMUJCpS5ynG7oUz4a5wfVOZavjSVWmEfl7z3k0xwdJ0Y8zmmIGnTHDSCkWuFfaTA59qvtRphaT/z96WgDt0AIiKiVP0ndAOIiGhaTXPYGVO8wG8m8JUxxYprG+WpaQ57yWT402HzC7Qv5RxUzVNp8ZknzJNJ+w5tgMm11PQtOIGFMtU0h0ru4y7XR4nTQeNz1/bLme2IvDTN4bsxxRPOrydtg/d+Atpz4BFu70OVMcU6orXL7wF89Nj+GsuogOL6bnIvpcGTwHd0IiIiOsagLxHRMuzgn623AQfNstU0h62s3eoyiHRlTFE1zaFUbRTFwGZQ8HquwSZjij2Ab46bXxtTvEtpII9opArAZ4ftPrw1aCwZkucCbjteTzSxCm4T0vp476duguMtgK8Om1/gNfAbw3m0g1/Q99KY4lopazhKxhQruE94DvF7eYT7essrpJUpvLb8XD1hG4iIiLLG8s5ERMtQKezjhmV8s1fCvczzjTFFqdcUCk0mAQxlDd7PmV0gWTY+656Veq0hik7lse1bEzyGJn1sPL6PyIZG8CX1e38dugG5kPXH7x03v0I8lQ00rotoSlZPxDXL9wVhgr4+kwlyfT+PYYIFERFRkhj0JSJagKY51HAPlPQtoRTYYkn2Qumxi69cOy8rpcVnqonb8BafNUR5D6NsyQQM14DGTwEAmeR1LijwwHKSNDU5x1zXYu3jvZ86JdwnOH6UMvpBSX/9znM3uU/mXTtuF6qChU/p8NTevVY2H4qonDoREVFyGPQlIloOn0BJ51bKZVGmpNTbXx67qDMfRFoEuc6HSsI/ByoNWHlseykZzES5cn3WXxpT9IO81zhfGnPj+D1EY1UK+7iU0r60cBLQ88ly/Xx0rwylUthHztfE2nG7jWIbxth7bJtj0Pdp6kYQERHljEFfIqLlqOA+s71zAQ70LsEG7i/bF2ApwhyUFp8JshacQoZLqdQUouh4VvboBzLOBQOe5XuIJicleTWq1Ww4KY2AH/dJnwmOVejKNkpVnG5zvCZk4uK59ehPmXXJkj7PrNaVVjtmYnPtMMuXiIjIA4O+REQLIYESjWzfG2bK5U2hzPOVMUWl0xoKpLT4jMb9xJVPwDn3koZErtfmjTHFOwlmnBsw3zjun8jVRmEfnLhIPzTN4RZ+ExyrCPoSG8/tL5Bntq9rJnbIfi3gXsreJcAdhFwz56qIdOqJm0JERJQ1Bn2JiJZlC/9sXyCOgY5JhJ65HwuZcf6Hxy5ujClKpebQjKRs4eXAx4Ku5yllpX0yXHIc5CTqVB7bXuP89fGCQFn+tFyK2b6f2M+jnhLu70VXCHwvVLoucsz2LR22uY+ggoVzdmtCE7Jt77/1lI0gIiLKHYO+REQLIhmcGsGOS2SYLSEvzN+MKTZhWxKHpjls4T7rHAC+JjQIQa9Ki89UE7fBRuWxbanUBkpbbgPdALxLoG9wPkuqkv0TzW2jtJ9KaT+UOJnguPHYxYcIKttsPLe/QPgMVzUWlSpOiWEyYO2xbQzrTNtYW3zmOeTEUiIiohww6EtEtDAyK9wnkNf5JBmBOel+nhhe/GNxDb/s8B2zatIh66B9HPjYi9xHQqs8tr3M8P5F4+V8b3IdxL/E+dKL2QQHKC2K/dcrYwqexwTgxwTHe49dBK1sI9eFa5nqTk5L97i8w32JJMhYe2y7VmrD1Gz63qwmQkRE5IlBXyKiZdIKalaZBfTW8qfNWkOLoLC+byzrnpGd0uIz1cRtsCIDdD4DtZzcQdmSDDbfQMCxu0gGxmm5tO7bOU5cJHcl/CY4hq5so3FdbFPvq0v7b0Zu9oxIJjPJO5drv/ZKJm5GS46PTRZ2NXFTiIiIssegLxHRAims19q5QJvJmfQgAfAjw7F7EdVY9zgbsn7qXx67CL7uWS6MKa4nHlgsLT4TxeCY8DmvPsQ+QNazCt0ASpL2tVop7y8mq9ANGGuG50F0pP/6RWl3uU1cJEcSbPOdBBCsso2sRevTTwfavvrGuzFhuQS/y8iWLPDp18Y+mbG0+Myz3OeJiIjIA4O+REQLpVDOrHMJoM4g8Fv2/j3Iy2bMg7dNc7iFX9ZYDOueHVuHbsAYMpj4NyYKoEvW0+XAxx5iyvSTsoY+kzRiHyDrrEI3IHIM3LxtB71JTE8SWMjVKnQDxpj6eRCzpjlsoFPmOZuJi+RP7m8+EwpCV7bZoM1a9fEpZKlqHzKJ7/PIzf6K8Lnm89wuI7+f2fS5Y5pYSkRElCwGfYmIlq2ETvnHKyQc+JV2919EY5rxHRPf9X1vjClSCbLFqMtCmar8uM2xqSb6bh+Vx7axD5CRHZbkf4NkL1VKu+NAbFymfh7E7hr+AS4gn4mL2Zsji1ZhQsEV/NZldaawHEtnm2gG/Nhn1JNMaI2KHEfXyTwXiHQyo0xsHppY+oI43zOIiIiSw6AvEdGC9QYINDKBUg783uLngVOWlXqDZHiWnrv5M9UsgiMhzvPJBuEkQ+LDwMdeJLM2Nj7BqAv4l3SMXYqDt6RHI1gb67W/ZIu+rnvleJfef03RUF/jlLmOj+95dRWqso1krfou33OB9npI5h4jlWo+jtjkBXFX+9l4bHsb6b1sY/GZbWSltomIiJLFoC8R0cLJujlr6A2c7RMbKFjh11nR+/lb4mW237fC+r4A8DWlc+SEEO2f8jttMgOiLCMqkxF8KhZsdFoSrRgH/2gmcn34lsJllu9564DfqVW+Ozm9/quGKwCPGfRNyJPS+r43xhRB7puyfM+d525Cl6q2Ju9x1YhNXgCsYw4uynPb9RheILJsWanyNDixFOxrEBERqWHQl4iItAO/3QzxUmFfc6jwa3nE/fzN8DJreUeF9X2BxLIIQpPfVVcWTWMtw2OlxWdiHozxadulZIkQ5cr32o352l8ceR50z/1FVyaR/uvvSrvrSj3zebBwCuv7AmHXx9Xop0c/EUKC0juMew8q5b4Ru43Hth9jeQ+X82dj8dFNzIH4I2vXDaXMNRER0eQY9CUiIgCTBH6/GlPsYp4lLrPwf5l5LIM9IUT7u3rDGn7nSnLl446sZ/6+cqody8DQ0IDZU+SDZDv4nY9RroHWk9K9gSIjFRpc1z+9S2gg1ofPNTb3c6yc+fuiJqXH/we9/uvfxhQbhX1RwmR933vP3XwNEXyTe/Ya/oHfbiJEdH11eb+s0Qanbf0uz8PoSbavz8SD4GszyzGqMPyO8SAZ6kRERKSEQV8iIvqhF/h1HRw+9hFtuefosiZkEObTG3+l9bO7iG5Q5ZTegJKP0OXj1h7bznas5PdT9v6XdgCmHPxEZKXijsn56DOQ9yHy2fc+51vWAWPPQc2VVjsSUDlut5SBWJ/zaK3ViCEzPA+SJJP11tArd/3ZmCLqLMcUefb3QhyLEv6B09QDvxcAvkmJ3ih4BHyrSRo0EZl44Hr8gk6uHXGMXsCJTEREROoY9CUiop9I4Pc99ErIdlkTtay7FJwxRQXg64m/3s/XEj0hXuqVyipeoR2USC0wdTHjIF6Fn2fJq2XcSqBzaJ0tINL1fI/4BqcqjUZEKPeghc+943L4I9moHLZ5iDzDPxZZPA9SJ+fqCv5Brs4V2mDXJnAfJbX+0TlJTWDqre/rO5kg9cAvAPwZw7ucfH8N+4DvC4DfUgv49pRwP/+6wO+sk69HHqNryWpOySrQtkRERNYY9CUiol80zeF70xzW8F/Pqu8DgH+NKapQAwbGFO+NKR4B3Jz5WD1Tc96y8tg2yKCgDKL4nidd4Hfu4NTKc/vJS6fJBIWPE37FxuIzzykMyMiAv0+m/mVMmSxHVqEbQGmTa/hu5GZLyfIF/CdHhHoeMNO3R/qv7wH8pbjbz2ir1oQK/uY0ccfn9xeqn7uHThZ56MCvb6lqoH2XewxV/lyCl4+wD/g+AVinPHlJ2l567GLWkvUjj9HvAZdU8uEzYXCl1QgiIqJzGPQlIqKTpKzU/6Bb8vgGbfC3nmvww5hiJYOl3zD8EhpyYGDlsW2wQUE5T8YGE46FCPz6Zvl1M+hLhbb8xJhifWaCQq31HbDL8k1psMw3SLUJncVygs+5anOMU7b22TjS4z2VasRnn1NZ+1DJ0JqDNtuHeB6kdH+eTdMcbqHbf73Az8HfldJ+beQU9PX5WUL2cx8BaEwK+xpicplMhriGzmTeC7Tlz/czv8ftAPwN+3v1PRIP+HbkWexbWWnSkvUOxyi5ctuASmWtlUY7iIiIhjDoS0REZ8kMXO2sCaANRHw1pvgu2b/XmhkU8vJ5a0xRA/gX57N7+0IODvgEZ4IOCjbNoYR/4LdbN6z0btAAxfVbL9Cex3tjiq0xRTl238YU72RQv5R97AH8g3FrlY0i11pl+fGUBswqz+0vEFkpa40BuswDm77PjZwCKmfJ89w2CLaYLN/EnwfM9D1hov5rF/z915hiJ8dpsgxUyc7znZAQkySDvsCPyja+gTegLZNchcga703m1Vj7+hKv97tJJkL0Ju3+C/uqNy8A/miaw7VkOWdB6fzrStZXWsFfqaJVYdwxSjLgK1ae2y+mz0lERGGZpmlCt4GIiBIhL4hbTJs59oQ2k3GP12DTvl9eVgZK+i9N3X93f76H2yDZc9McVg7beZOB4X88dhGs7X3y4m8bYD/nHkA51YCNDKR+nmLfU2uag/Hdh8zGtx2c+SIDhUlQOgfvZCJDcJIV9Kfnbv5omkOWQTzJgPSZIBHNsZ6D5fn0AmCV04D5OUt/HiyBBKQqTNd/fUDbd60BPPpeO9InvIXn8g6xnR/GFN/hF8T+LXTmpkxM/Kqwq2e0/dxaYV+j9Cb+aS8f8iT7rV2Pk7TtWv4Z274HtL/Tvct3p0DKJ1fQmQzidLzk/tQdozGVaF6QePa10jvGf3M+R4mIKA4M+hIR0WjywrmFf3nc2AQb/Fd6iYwisKM4gP4CYDPFzyTZUymev17BfRlM22LcufaXlMpMgtyf/lbYVRTBQKVz9RnA+9yCeAqTZYD2PvN+KQNwcg/4v4GPJXXN+1rq82CJ5J6xwfRl75/xOnmxu+/WJz67wmv22BruExeP3UtJ3ygoPZuj+JlkEmwNneN0h7avu1fY1yhyPVSY7v73gNdroH8tHFujvQbew20S1zOA26UsSSDnXwX9ikAP8mf9xt+t0U6udv3OBwBJZ19L/2kP/+t+UX0sIiIKg0FfIiJyJgM4t8hnzcgg5aYUswZe0A56VAr78qI8E/1Z9lVpDIopZiOH8NA0h7XLhjK4t8X4AZuksv5kMOyb0u4e0F5TQbISjCm2AD4p7e4J7YDbXml/QcngWw2dQc9gGVchWNwDF5OFstTnwdLJ87BEusd+yB3aZ1cUz225Xz9CJ7gYxc8m2eM76AXe7gBsQ/Q35D1kg/QmvzyjDZhXoRsyN7mmNtDrI05lsgm8c1PuLyRVRYmIiNLDoC8REXmTIMst2jJPqa49NkvGjAwSdd+zRjurXbu82jPagajvaGck73t/51120JZjVumQrvz3I+TnOheokXPzHV5Lf19jwrVyZzA4SHC0huQKrz+3z2DeC9pjWQP4HmtpNo/A9pAntNfUHr3rSTNIOOO52pUhBY6yOWINeh6V9O9K+E/xvOnuL29lJc1275zawMSIKDLcp7DE5wGdJ/eWEm0fNrWA17EXtM+pIFmjnaP79Ur+vYTu/foFr33B7n7d2c/580t1m1vo/XzPeP3Z3lzmZioJBX8XG+w9NtPSS66imKDhovcu1d3PSuhfF909e49f39dnvY8REVF+GPQlIiJVMmBwjTagmUoAePI1oEauoTqlZ7TZfrMF7WbIqPnlZ1JYNy5WJ9ezm7Dc25D/xRAsDFSi9QntvcP5eorwXI2ifCagtp6xpmxKQRtT1Hh7kDi7LN8IrzEt2R2rkOQZWqLtv6Y0GeAebeBgFzK4oli1RsOsEyIk0H0L3eDvsdmqEUWaCd8FyKoY+pyx0VoHXEmwkuU+ZGL2I+LqLwSpQkZEROn7T+gGEBFRXuTFpAJ+vIB2AeDYBtC6jK5qpgDo3nG7bl24ju9ab5eyj9mCvjI4U0sApzsfVtBbt+6tn2mPcefcC87/TrTa6uNu4FxdwW+trf5+Ys/yeMsOr1mgcx2rlfzjcz3t4b6G3f7o/2lkehzvM6S9x7YPR/+9Qprn9VQ2+HU95LvUBmkt7ZHn82AfuA1ZkefrLfBj8H/d+yeme0fXf60B1BFl0fm0Q7sPsvbcfhQ5BhsAG1ne5D1e+7pa5063bMrkTvTbQ1Rz6gK9u6Ws1+uqd8xWaI9ViXnfvZ/RZhzvEn42+dzDjvvk76Dz+4/l/k5ERIlhpi8REc1GgsBdUGaF+UpRdS9iNaRcWogX0qPSzp1JSob2ylgei7JE6Ynfja03f6ajfU5WkvjM77rP5jOnfEc7sDvY/qOyin0qx/2N4xTl+WTrzO9riOr59NY5NGUmy5lzNrpycieO0WTtPHMvirasuaujbN9sspjfcnTOL+J5QHrkvtD1X9fQG9Af8oDXsp81EnjmHi0xAUx0vz5zr47uOQZ49TeASH4mub+t8bo8jfZkiCe8lrXmfc7TxJNXuslRO2R2rObsk5+7LzCjnYiIfDDoS0REQb2xVmP3krWCfRBwj59n19bd/49hkISIiCg28vyt0D53b3MatCWaQy/w2O/LjgnuPeI1k+u7/DcH+ykZvSB/96fN+d8/72tkOKkqVnK8+sdoheH37T1e37Nr8P2aiIgoev8PAnpGjnTbC2MAAAAASUVORK5CYII=" alt="TCG"></div>
  <div class="hdr-right">
    <div class="hdr-doc">Production Brief</div>
    <div class="hdr-conf">Confidential &nbsp;·&nbsp; ${new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
  </div>
</div>
<hr class="hdr-divider">

<div class="show-name">${event.name}</div>
<div class="show-meta">${[event.client, dateRange].filter(Boolean).join("&nbsp; · &nbsp;")}</div>

<div class="info-grid">
  <div class="info-block">
    <div class="info-label">Venue</div>
    ${event.venue?.name ? '<div class="info-name">' + event.venue.name + '</div>' : '<div style="color:#999">No venue set</div>'}
    ${event.venue?.address ? '<div class="info-detail">' + event.venue.address + '</div>' : ""}
  </div>
  <div class="info-block">
    <div class="info-label">Hotel</div>
    ${it.hotelName ? '<div class="info-name">' + it.hotelName + '</div>' : '<div style="color:#999">No hotel set</div>'}
    ${it.hotelAddress ? '<div class="info-detail">' + it.hotelAddress + '</div>' : ""}
    ${stays.length && (it.checkIn || stays[0]?.checkIn) ? '<div class="info-detail" style="margin-top:4pt">Check-in ' + fmt(it.checkIn || stays[0]?.checkIn) + ' &nbsp;·&nbsp; Check-out ' + fmt(it.checkOut || (stays[stays.length-1]?.checkOut)) + '</div>' : ""}
  </div>
</div>

<div class="sect">
  <div class="sect-title">Crew</div>
  ${crew.length ? '<table><thead><tr><th>Name</th><th>Role</th><th>Confirmation #</th><th>Check-in</th><th>Check-out</th></tr></thead><tbody>' + crewRows + '</tbody></table>' : '<div style="color:#999">No crew listed</div>'}
</div>

<div class="sect">
  <div class="sect-title">Schedule Overview</div>
  ${schedule.length ? schedRows : '<div style="color:#999">No schedule posted</div>'}
</div>

<div class="footer">
  <span>Touchstone Creative Group &nbsp;·&nbsp; touchstonecreativegroup.com</span>
  <span>${event.name} &nbsp;·&nbsp; ${dateRange}</span>
</div>

</div></body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => { win.focus(); win.print(); }, 400);
    }
  };

  return (
    <div className="stack">
      <div className="brief-export-bar">
        <button className="brief-export-btn" onClick={exportBriefPDF}>
          📄 Export Production Brief PDF
        </button>
        <span className="brief-export-hint">Includes venue, hotel, crew, and schedule overview</span>
      </div>

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
              {isAdmin && (
                <input
                  className="crew-admin-notes"
                  value={c.crewNotes || ""}
                  placeholder="Admin notes (private — crew can't see this)"
                  onChange={(e) => update((ev) => (ev.crew[i].crewNotes = e.target.value))}
                />
              )}
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
function IOList({ event, update, kind, block, bi, side, readOnly }) {
  const rows = block[side];
  const label = side === "ins" ? "Source" : "Destination";
  const addRow = () =>
    update((ev) => ev[kind].blocks[bi][side].push(ioRow(rows.length + 1)));
  return (
    <div className="io-side">
      <div className="io-side-h">{side === "ins" ? "Inputs" : "Outputs"}</div>
      <div className="rows scroll-x">
        <div className="rowhead io-grid">
          <span>#</span><span>{label}</span><span>Patch</span><span>Signal</span><span>Notes</span>{!readOnly && <span />}
        </div>
        {rows.map((r, ri) => (
          readOnly ? (
            <div className="row io-grid io-ro" key={r.id}>
              <span className="io-ro-cell dim">{r.num}</span>
              <span className="io-ro-cell">{r.name}</span>
              <span className="io-ro-cell dim">{r.patch}</span>
              <span className="io-ro-cell dim">{r.signal}</span>
              <span className="io-ro-cell dim">{r.notes}</span>
            </div>
          ) : (
            <div className="row io-grid" key={r.id}>
              <input className="io-num" value={r.num} onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].num = e.target.value))} />
              <input value={r.name} placeholder={label} onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].name = e.target.value))} />
              <input value={r.patch} placeholder="Patch" onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].patch = e.target.value))} />
              <input value={r.signal} placeholder="Signal" onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].signal = e.target.value))} />
              <input value={r.notes} placeholder="Notes" onChange={(e) => update((ev) => (ev[kind].blocks[bi][side][ri].notes = e.target.value))} />
              <RemoveBtn onClick={() => update((ev) => ev[kind].blocks[bi][side].splice(ri, 1))} />
            </div>
          )
        ))}
        {!rows.length && <Empty>No {side === "ins" ? "inputs" : "outputs"} yet.</Empty>}
      </div>
      {!readOnly && <AddBtn onClick={addRow}>{side === "ins" ? "Input" : "Output"}</AddBtn>}
    </div>
  );
}

function IOTab({ event, update, kind, isAdmin }) {
  const data = event[kind];
  const title = kind === "audio" ? "Audio" : "Video";
  const lockKey = kind === "audio" ? "audioUnlocked" : "videoUnlocked";
  const unlocked = !!event[lockKey];
  const canEdit = isAdmin || unlocked;
  const addBlock = () => update((ev) => ev[kind].blocks.push(ioBlock("New device")));
  return (
    <div className="stack">
      {/* lock bar */}
      <div className="pl-bar">
        <div className="pl-lockwrap">
          {isAdmin ? (
            <button className={"pl-lock " + (unlocked ? "open" : "")} onClick={() => update((ev) => (ev[lockKey] = !unlocked))}>
              {unlocked ? "🔓 Crew editing ON" : "🔒 Crew editing OFF"}
            </button>
          ) : unlocked ? (
            <span className="pl-locknote open">🔓 Editing unlocked by admin</span>
          ) : (
            <span className="pl-locknote">🔒 {title} I/O locked — view only</span>
          )}
          {isAdmin && (
            <span className="pl-lockhint">
              {unlocked ? `Any crew on this show can edit the ${title} patch.` : `Only you (admin) can edit the ${title} patch.`}
            </span>
          )}
        </div>
      </div>

      <div className="tab-lead">
        <p>{title} in / out patch. Add a device for each console, switcher, or processor, then list its inputs and outputs.</p>
        {canEdit && <AddBtn onClick={addBlock}>Device</AddBtn>}
      </div>

      {data.blocks.map((block, bi) => (
        <Panel
          key={block.id}
          title={canEdit
            ? <input className="daytitle" value={block.name} placeholder="Device / console" onChange={(e) => update((ev) => (ev[kind].blocks[bi].name = e.target.value))} />
            : <span className="daytitle-ro">{block.name || "Device"}</span>
          }
          action={canEdit
            ? <RemoveBtn title="Remove device" onClick={() => update((ev) => ev[kind].blocks.splice(bi, 1))} />
            : null
          }
        >
          <div className="io-cols">
            <IOList event={event} update={update} kind={kind} block={block} bi={bi} side="ins" readOnly={!canEdit} />
            <IOList event={event} update={update} kind={kind} block={block} bi={bi} side="outs" readOnly={!canEdit} />
          </div>
        </Panel>
      ))}
      {!data.blocks.length && (
        <Panel title={title + " I/O"}>
          <Empty>{canEdit ? "No devices yet. Add one to start the patch sheet." : "No patch sheet yet."}</Empty>
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
  const prevOpenRef = useRef(null);

  // Expand all cases before printing, restore after
  useEffect(() => {
    const beforePrint = () => {
      setOpen((prev) => {
        prevOpenRef.current = prev;
        return new Set(cases.map((c) => c.id).concat(["__loose__"]));
      });
    };
    const afterPrint = () => {
      if (prevOpenRef.current !== null) {
        setOpen(prevOpenRef.current);
        prevOpenRef.current = null;
      }
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [cases]);
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

      {/* ---- dedicated print-only view ---- */}
      <div className="pl-print">
        <div className="pl-print-hdr">
          <div>
            <div className="pl-print-co">Touchstone Creative Group</div>
            <div className="pl-print-show">{event.name}</div>
            <div className="pl-print-meta">
              {event.client && <span>{event.client} &nbsp;·&nbsp; </span>}
              {event.startDate && <span>{prettyDate(event.startDate)}{event.endDate && event.endDate !== event.startDate ? ` – ${prettyDate(event.endDate)}` : ""}</span>}
              {event.venue?.name && <span> &nbsp;·&nbsp; {event.venue.name}</span>}
            </div>
          </div>
          <div className="pl-print-title">PULL LIST</div>
        </div>
        <div className="pl-print-stats">
          {cases.reduce((n, c) => n + c.items.length, 0) + loose.length} items
          &nbsp;·&nbsp; {cases.length} cases
          {loose.length > 0 && ` · ${loose.length} loose`}
        </div>

        {PULL_CAT_ORDER.filter(k => cases.some(c => c.category === k)).map(k => (
          <div key={k} className="pl-print-cat">
            <div className="pl-print-cathdr">{k}</div>
            {cases.filter(c => c.category === k).map(c => (
              <div key={c.id} className="pl-print-case">
                <div className="pl-print-casehdr">
                  <span className="pl-print-casenum">#{c.caseNo}</span>
                  <span className="pl-print-casename">{c.case}</span>
                </div>
                {groupPullByDrawer(c.items).map((g, gi) => (
                  <div key={gi}>
                    {g.drawer && <div className="pl-print-drawer">{g.drawer}</div>}
                    {g.items.map(it => (
                      <div key={it.id} className="pl-print-item">
                        <span className="pl-print-cb">□</span>
                        <span className="pl-print-iname">{it.item}</span>
                        {it.qty !== "" && <span className="pl-print-qty">×{it.qty}</span>}
                        {it.source && it.source !== "TCG" && <span className="pl-print-src">{it.source}{it.rentedFrom ? ` / ${it.rentedFrom}` : ""}</span>}
                        {it.notes && <span className="pl-print-note">{it.notes}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}

        {loose.length > 0 && (
          <div className="pl-print-cat">
            <div className="pl-print-cathdr">Loose / Unassigned</div>
            {loose.map(it => (
              <div key={it.id} className="pl-print-item">
                <span className="pl-print-cb">□</span>
                <span className="pl-print-iname">{it.item}</span>
                {it.qty !== "" && <span className="pl-print-qty">×{it.qty}</span>}
                {it.source && it.source !== "TCG" && <span className="pl-print-src">{it.source}</span>}
                {it.notes && <span className="pl-print-note">{it.notes}</span>}
              </div>
            ))}
          </div>
        )}
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

/* tab access panel (home screen, admin only) */
.cb .tab-access-panel { margin-top:22px; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; }
.cb .tab-access-title { font-family:'Oswald'; font-size:12px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); margin-bottom:12px; }
.cb .tab-access-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:6px; }
.cb .tab-access-row { display:flex; align-items:center; justify-content:space-between; background:var(--panel2); border:1px solid var(--line); border-radius:9px; padding:8px 12px; cursor:pointer; text-align:left; gap:8px; }
.cb .tab-access-row.open { border-color:rgba(74,222,128,.3); background:rgba(74,222,128,.05); }
.cb .tab-access-label { font-size:13px; font-weight:600; color:var(--ink); }
.cb .tab-access-badge { font-size:12px; color:var(--dim); white-space:nowrap; flex-shrink:0; }
.cb .tab-access-row.open .tab-access-badge { color:var(--green); }
.cb .tab-access-hint { font-size:11.5px; color:var(--faint); margin-top:10px; }

/* locked tab — disable all editing controls for crew */
.cb .tab-lock-notice { background:rgba(255,176,32,.08); border:1px solid rgba(255,176,32,.2); border-radius:10px; padding:9px 14px; font-size:13px; font-weight:600; color:var(--amber); margin-bottom:14px; }
.cb .tab-locked input, .cb .tab-locked textarea, .cb .tab-locked select { pointer-events:none !important; opacity:0.65; cursor:default; }
.cb .tab-locked .add-btn, .cb .tab-locked .rem-btn, .cb .tab-locked [class*="AddBtn"], .cb .tab-locked [class*="RemoveBtn"] { display:none !important; }
.cb .tab-locked .movebtn, .cb .tab-locked .daysort { display:none !important; }
.cb .tab-locked button:not(.pl-lock) { pointer-events:none; opacity:0.5; }
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
.cb .print-btn{margin-left:12px; border:1px solid var(--line); background:transparent; color:var(--dim); border-radius:8px; padding:6px 12px; font-size:12.5px; font-weight:600; cursor:pointer; white-space:nowrap; flex-shrink:0;}
.cb .print-btn:hover{border-color:var(--amber); color:var(--amber);}

@media print {
  /* hide everything except the content */
  .cb .topbar, .cb .pagebar, .cb .tab-lock-notice,
  .cb .pl-bar, .cb .pl-controls, .cb .pl-toolbar, .cb .pl-import,
  .cb .pl-addcase, .cb .pl-clear, .cb .pl-additem, .cb .pl-adddrawer, .cb .pl-invsave,
  .cb .add-btn, .cb .rem-btn, .cb .movebtn, .cb .daysort,
  .cb .copy-emails-btn, .cb .previewbtn, .cb .linkprev-frame, .cb .linkprev-note,
  .cb .tab-access-panel, .cb .crew-admin-notes,
  .cb .ot-summary, .cb .headedit, .cb .pl-headedit,
  button:not(.backbtn) { display: none !important; }

  /* paper setup */
  body, .cb { background: #fff !important; color: #111 !important; font-size: 11pt; }
  .cb .content { padding: 0 !important; }
  .cb .panel { border: 1px solid #ccc !important; background: #fff !important; break-inside: avoid; margin-bottom: 12pt; }
  .cb .panel-title { color: #111 !important; font-size: 13pt; }

  /* print header — show show name + tab name at top */
  .cb .content::before {
    content: attr(data-show) " — " attr(data-tab);
    display: block;
    font-weight: 700;
    font-size: 16pt;
    margin-bottom: 14pt;
    padding-bottom: 8pt;
    border-bottom: 2pt solid #111;
  }

  /* fix dark-theme text colors for print */
  .cb .panel, .cb .stack, .cb input, .cb select, .cb textarea,
  .cb .sched-ro-act, .cb .sched-ro-time,
  .cb .io-ro-cell, .cb .pl-itemname, .cb .pl-row,
  .cb .roster-name, .cb .roster-pos, .cb .roster-contact { color: #111 !important; }
  .cb .sched-ro-time { color: #333 !important; }
  .cb input, .cb select, .cb textarea { border-color: #ccc !important; background: #fff !important; }

  /* schedule */
  .cb .sched-ro { break-inside: avoid; }

  /* pull list — hide screen version, show dedicated print layout */
  .cb .pull > *:not(.pl-print) { display: none !important; }
  .cb .pl-print { display: block !important; }

  /* print layout */
  .cb .pl-print { color: #000; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; }
  .cb .pl-print-hdr { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10pt; margin-bottom: 12pt; border-bottom: 2pt solid #000; }
  .cb .pl-print-co { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: #666; margin-bottom: 3pt; }
  .cb .pl-print-show { font-size: 18pt; font-weight: 700; color: #000; line-height: 1.1; }
  .cb .pl-print-meta { font-size: 9pt; color: #555; margin-top: 3pt; }
  .cb .pl-print-title { font-size: 24pt; font-weight: 700; letter-spacing: .05em; color: #000; align-self: center; }
  .cb .pl-print-stats { font-size: 9pt; color: #777; margin-bottom: 14pt; }

  .cb .pl-print-cat { margin-bottom: 18pt; }
  .cb .pl-print-cathdr { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .18em; color: #888; border-bottom: 0.75pt solid #999; padding-bottom: 3pt; margin-bottom: 8pt; }

  .cb .pl-print-case { break-inside: avoid; margin-bottom: 12pt; }
  .cb .pl-print-casehdr { display: flex; align-items: center; gap: 7pt; margin-bottom: 4pt; padding-bottom: 3pt; border-bottom: 0.5pt solid #ddd; }
  .cb .pl-print-casenum { font-size: 8pt; font-weight: 700; color: #fff; background: #333; border-radius: 3pt; padding: 1.5pt 6pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cb .pl-print-casename { font-size: 11pt; font-weight: 700; color: #000; }

  .cb .pl-print-drawer { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #999; margin: 5pt 0 2pt 10pt; }

  .cb .pl-print-item { display: flex; align-items: baseline; gap: 5pt; padding: 3pt 0 3pt 10pt; border-bottom: 0.25pt solid #f0f0f0; }
  .cb .pl-print-cb { font-size: 11pt; color: #bbb; flex-shrink: 0; width: 12pt; }
  .cb .pl-print-iname { flex: 1; font-size: 10pt; color: #000; min-width: 0; }
  .cb .pl-print-qty { font-size: 10pt; font-weight: 700; color: #000; flex-shrink: 0; min-width: 22pt; text-align: right; }
  .cb .pl-print-src { font-size: 8pt; color: #555; background: #f0f0f0; padding: 0 5pt; border-radius: 2pt; flex-shrink: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cb .pl-print-note { font-size: 8pt; color: #888; font-style: italic; flex-shrink: 0; }

  /* crew grid */
  .cb .crew-grid input { border: none !important; padding: 2px 4px !important; }
  .cb .row-tools { display: none !important; }

  /* IO patch */
  .cb .io-grid input { border: none !important; font-size: 9pt !important; }
  .cb .scroll-x { overflow: visible !important; }

  /* ensure full width */
  .cb .content { max-width: 100% !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}

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
.cb .crew-admin-notes { grid-column:1 / -1; margin-top:3px; background:transparent; border:none; border-bottom:1px dashed rgba(255,176,32,.25); border-radius:0; padding:3px 4px; font-size:11.5px; color:var(--amber); opacity:.8; }
.cb .crew-admin-notes:focus { outline:none; border-bottom-color:var(--amber); opacity:1; }
.cb .crew-admin-notes::placeholder { color:var(--amber); opacity:.4; }
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
.cb .sched-ro-time{flex:0 0 88px; font-weight:700; color:var(--amber); font-variant-numeric:tabular-nums;}
.cb .sched-ro-act{flex:1; color:var(--ink);}
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
.cb .io-ro { min-width:420px; }
.cb .io-ro-cell { display:flex; align-items:center; padding:0 4px; font-size:13px; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cb .io-ro-cell.dim { color:var(--dim); }

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
.pl-hash { color:#475569; font-size:12px; font-weight:700; }
.pl-caseno { color:#fff; font-size:11.5px; font-weight:700; border-radius:6px; padding:2px 7px; flex-shrink:0; }
.pl-casename { font-weight:700; font-size:14px; color:#0F1E35; }
.pl-tag { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; border:1px solid; border-radius:999px; padding:1px 8px; }
.pl-spacer { flex:1; }
.pl-count { font-size:12px; color:#334155; font-weight:600; white-space:nowrap; }
.pl-count em { font-style:normal; }
.pl-chev { font-size:20px; color:#64748B; margin-right:12px; line-height:1; transition:transform .15s; }
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
.cb .brief-export-bar { display:flex; align-items:center; gap:12px; padding:12px 14px; background:var(--panel); border:1px solid var(--line); border-radius:12px; }
.cb .brief-export-btn { border:none; background:var(--amber); color:#000; border-radius:8px; padding:8px 16px; font-size:13px; font-weight:700; cursor:pointer; white-space:nowrap; }
.cb .brief-export-btn:hover { background:var(--amber-deep); }
.cb .brief-export-hint { font-size:12px; color:var(--faint); }
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
.pl-print { display:none; } /* shown only in @media print */
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
