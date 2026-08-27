/**
 * Indian administrative regions.
 *
 * Note on the count: the request said "32 states". India has 28 states and 8
 * union territories — 36 administrative regions, no arrangement of which comes
 * to 32. The accurate list is used here, with `region_type` distinguishing the
 * two, because the request also asked for the state/district data to be
 * correct and the admin drilldown labels them separately.
 *
 * Codes are ISO 3166-2:IN subdivision codes.
 */

export const STATES = [
  // --- 28 states ---
  { name: 'Andhra Pradesh',    code: 'AP',  region_type: 'state' },
  { name: 'Arunachal Pradesh', code: 'AR',  region_type: 'state' },
  { name: 'Assam',             code: 'AS',  region_type: 'state' },
  { name: 'Bihar',             code: 'BR',  region_type: 'state' },
  { name: 'Chhattisgarh',      code: 'CG',  region_type: 'state' },
  { name: 'Goa',               code: 'GA',  region_type: 'state' },
  { name: 'Gujarat',           code: 'GJ',  region_type: 'state' },
  { name: 'Haryana',           code: 'HR',  region_type: 'state' },
  { name: 'Himachal Pradesh',  code: 'HP',  region_type: 'state' },
  { name: 'Jharkhand',         code: 'JH',  region_type: 'state' },
  { name: 'Karnataka',         code: 'KA',  region_type: 'state' },
  { name: 'Kerala',            code: 'KL',  region_type: 'state' },
  { name: 'Madhya Pradesh',    code: 'MP',  region_type: 'state' },
  { name: 'Maharashtra',       code: 'MH',  region_type: 'state' },
  { name: 'Manipur',           code: 'MN',  region_type: 'state' },
  { name: 'Meghalaya',         code: 'ML',  region_type: 'state' },
  { name: 'Mizoram',           code: 'MZ',  region_type: 'state' },
  { name: 'Nagaland',          code: 'NL',  region_type: 'state' },
  { name: 'Odisha',            code: 'OD',  region_type: 'state' },
  { name: 'Punjab',            code: 'PB',  region_type: 'state' },
  { name: 'Rajasthan',         code: 'RJ',  region_type: 'state' },
  { name: 'Sikkim',            code: 'SK',  region_type: 'state' },
  { name: 'Tamil Nadu',        code: 'TN',  region_type: 'state' },
  { name: 'Telangana',         code: 'TG',  region_type: 'state' },
  { name: 'Tripura',           code: 'TR',  region_type: 'state' },
  { name: 'Uttar Pradesh',     code: 'UP',  region_type: 'state' },
  { name: 'Uttarakhand',       code: 'UK',  region_type: 'state' },
  { name: 'West Bengal',       code: 'WB',  region_type: 'state' },

  // --- 8 union territories ---
  { name: 'Andaman and Nicobar Islands',              code: 'AN', region_type: 'union_territory' },
  { name: 'Chandigarh',                               code: 'CH', region_type: 'union_territory' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', code: 'DH', region_type: 'union_territory' },
  { name: 'Delhi',                                    code: 'DL', region_type: 'union_territory' },
  { name: 'Jammu and Kashmir',                        code: 'JK', region_type: 'union_territory' },
  { name: 'Ladakh',                                   code: 'LA', region_type: 'union_territory' },
  { name: 'Lakshadweep',                              code: 'LD', region_type: 'union_territory' },
  { name: 'Puducherry',                               code: 'PY', region_type: 'union_territory' }
];

/**
 * All 75 districts of Uttar Pradesh.
 *
 * This is the only state seeded with districts and staff — the request asked
 * for UP specifically. Every other state exists as a row so the admin
 * drilldown renders the full country, and shows zero coverage for the rest.
 */
export const UP_DISTRICTS = [
  'Agra', 'Aligarh', 'Ambedkar Nagar', 'Amethi', 'Amroha',
  'Auraiya', 'Ayodhya', 'Azamgarh', 'Baghpat', 'Bahraich',
  'Ballia', 'Balrampur', 'Banda', 'Barabanki', 'Bareilly',
  'Basti', 'Bhadohi', 'Bijnor', 'Budaun', 'Bulandshahr',
  'Chandauli', 'Chitrakoot', 'Deoria', 'Etah', 'Etawah',
  'Farrukhabad', 'Fatehpur', 'Firozabad', 'Gautam Buddha Nagar', 'Ghaziabad',
  'Ghazipur', 'Gonda', 'Gorakhpur', 'Hamirpur', 'Hapur',
  'Hardoi', 'Hathras', 'Jalaun', 'Jaunpur', 'Jhansi',
  'Kannauj', 'Kanpur Dehat', 'Kanpur Nagar', 'Kasganj', 'Kaushambi',
  'Kushinagar', 'Lakhimpur Kheri', 'Lalitpur', 'Lucknow', 'Maharajganj',
  'Mahoba', 'Mainpuri', 'Mathura', 'Mau', 'Meerut',
  'Mirzapur', 'Moradabad', 'Muzaffarnagar', 'Pilibhit', 'Pratapgarh',
  'Prayagraj', 'Raebareli', 'Rampur', 'Saharanpur', 'Sambhal',
  'Sant Kabir Nagar', 'Shahjahanpur', 'Shamli', 'Shravasti', 'Siddharthnagar',
  'Sitapur', 'Sonbhadra', 'Sultanpur', 'Unnao', 'Varanasi'
];

/** Representative villages per district, cycled when generating patients. */
export const VILLAGE_SUFFIXES = [
  'Kalan', 'Khurd', 'Ganj', 'Nagar', 'Pur', 'Khera', 'Garhi', 'Tola', 'Patti', 'Majra'
];
