/**
 * filters.js
 * -----------------------------------------------------------------------
 * Data + pure filtering logic for the Stock Filter app.
 * No DOM access and no THREE.js here — keeps the filtering rules
 * testable and independent of how the scene is rendered.
 *
 * Filtering is based strictly on Book Value and P/B Ratio.
 * Sector/tier only drive color and depth placement in the 3D scene —
 * they are never filter criteria, and company name is never a filter.
 * -----------------------------------------------------------------------
 */

/* Illustrative-only figures — not live market data. */
export const STOCKS = [
  { name:"Tata Steel",         sector:"Metals",             bookValue:62,   pbRatio:2.1,  tier:"Large" },
  { name:"Infosys",            sector:"IT",                 bookValue:335,  pbRatio:7.8,  tier:"Large" },
  { name:"HDFC Bank",          sector:"Financials",         bookValue:610,  pbRatio:2.9,  tier:"Large" },
  { name:"Reliance Industries",sector:"Energy",             bookValue:1180, pbRatio:2.2,  tier:"Large" },
  { name:"ITC",                sector:"FMCG",               bookValue:58,   pbRatio:7.1,  tier:"Large" },
  { name:"Maruti Suzuki",      sector:"Auto",                bookValue:2210, pbRatio:4.6,  tier:"Large" },
  { name:"Sun Pharma",         sector:"Pharma",              bookValue:245,  pbRatio:6.9,  tier:"Large" },
  { name:"Bajaj Finance",      sector:"Financials",         bookValue:980,  pbRatio:5.4,  tier:"Large" },
  { name:"UltraTech Cement",   sector:"Cement",              bookValue:1720, pbRatio:5.9,  tier:"Large" },
  { name:"Coal India",         sector:"Energy",             bookValue:78,   pbRatio:3.4,  tier:"Large" },
  { name:"Godrej Consumer",    sector:"FMCG",               bookValue:112,  pbRatio:9.2,  tier:"Mid" },
  { name:"Persistent Systems", sector:"IT",                 bookValue:410,  pbRatio:11.3, tier:"Mid" },
  { name:"Voltas",             sector:"Consumer Durables",  bookValue:196,  pbRatio:6.4,  tier:"Mid" },
  { name:"Federal Bank",       sector:"Financials",         bookValue:118,  pbRatio:1.4,  tier:"Mid" },
  { name:"Astral",             sector:"Chemicals",          bookValue:224,  pbRatio:8.7,  tier:"Mid" },
  { name:"Trent",              sector:"Retail",              bookValue:310,  pbRatio:16.2, tier:"Mid" },
  { name:"Aarti Industries",   sector:"Chemicals",          bookValue:186,  pbRatio:3.1,  tier:"Mid" },
  { name:"IRCTC",              sector:"Services",            bookValue:36,   pbRatio:19.4, tier:"Mid" },
  { name:"KPIT Technologies",  sector:"IT",                 bookValue:96,   pbRatio:12.8, tier:"Small" },
  { name:"Chalet Hotels",      sector:"Hospitality",        bookValue:142,  pbRatio:4.8,  tier:"Small" },
  { name:"Mishra Dhatu Nigam", sector:"Metals",             bookValue:88,   pbRatio:5.6,  tier:"Small" },
  { name:"Route Mobile",       sector:"IT",                 bookValue:210,  pbRatio:3.9,  tier:"Small" },
  { name:"Gravita India",      sector:"Metals",             bookValue:130,  pbRatio:7.4,  tier:"Small" },
  { name:"Suven Pharma",       sector:"Pharma",              bookValue:74,   pbRatio:10.1, tier:"Small" },
];

export const SECTOR_COLORS = {
  "Metals":0x8a97b5, "IT":0x43e0c4, "Financials":0xd4af37, "Energy":0xe0625f,
  "FMCG":0x8fd694, "Auto":0xf0a24c, "Pharma":0x7fb8e0, "Cement":0xb08bd6,
  "Chemicals":0xd68ba0, "Retail":0xe0c34c, "Services":0x6fcbd6,
  "Consumer Durables":0xc4a8e0, "Hospitality":0xe0925f
};

export const TIER_Z = { "Large": 46, "Mid": 0, "Small": -46 };

/**
 * @typedef {Object} FilterCriteria
 * @property {number|null} minBookValue
 * @property {number|null} maxBookValue
 * @property {number|null} minPB
 * @property {number|null} maxPB
 */

/**
 * Applies the given criteria to a stock list.
 * Filtering runs solely on Book Value and P/B Ratio — never on
 * company name, sector, or any other field.
 * @param {Array<Object>} stocks
 * @param {FilterCriteria} criteria
 * @returns {Array<Object>}
 */
export function applyFilters(stocks, criteria) {
  const {
    minBookValue = null,
    maxBookValue = null,
    minPB = null,
    maxPB = null,
  } = criteria;

  return stocks.filter((stock) => {
    const matchesMinBookValue = minBookValue === null || stock.bookValue >= minBookValue;
    const matchesMaxBookValue = maxBookValue === null || stock.bookValue <= maxBookValue;
    const matchesMinPB = minPB === null || stock.pbRatio >= minPB;
    const matchesMaxPB = maxPB === null || stock.pbRatio <= maxPB;

    return matchesMinBookValue && matchesMaxBookValue && matchesMinPB && matchesMaxPB;
  });
}
