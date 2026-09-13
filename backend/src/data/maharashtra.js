/**
 * Maharashtra: its 36 districts and the name pools its demo records draw from.
 *
 * Kept apart from regions.js and indianNames.js rather than folded into them.
 * Those pools are North Indian — Srivastava, Tripathi, Awadhi, Bhojpuri — and a
 * Maharashtra clinic staffed by them would read as exactly what it is: Uttar
 * Pradesh data with the district names swapped. The names, villages and
 * languages below are the ones a health worker in Maharashtra would actually
 * meet.
 *
 * District names are the current official ones. Three were renamed recently:
 * Ahilyanagar (formerly Ahmednagar), Chhatrapati Sambhajinagar (formerly
 * Aurangabad) and Dharashiv (formerly Osmanabad). The referral dataset records
 * the former names too, so either still finds its hospital.
 *
 * `pin` is the district headquarters' PIN code, used as the base for generated
 * patient addresses. Maharashtra PINs run 40xxxx-44xxxx.
 *
 * Nothing here is a real person. Given names and surnames are combined at
 * random and every generated record is written with is_demo = true.
 */

export const MH_STATE_CODE = 'MH';

export const MH_DISTRICTS = [
  { name: 'Ahilyanagar',               pin: 414001 },
  { name: 'Akola',                     pin: 444001 },
  { name: 'Amravati',                  pin: 444601 },
  { name: 'Beed',                      pin: 431122 },
  { name: 'Bhandara',                  pin: 441904 },
  { name: 'Buldhana',                  pin: 443001 },
  { name: 'Chandrapur',                pin: 442401 },
  { name: 'Chhatrapati Sambhajinagar', pin: 431001 },
  { name: 'Dharashiv',                 pin: 413501 },
  { name: 'Dhule',                     pin: 424001 },
  { name: 'Gadchiroli',                pin: 442605 },
  { name: 'Gondia',                    pin: 441601 },
  { name: 'Hingoli',                   pin: 431513 },
  { name: 'Jalgaon',                   pin: 425001 },
  { name: 'Jalna',                     pin: 431203 },
  { name: 'Kolhapur',                  pin: 416001 },
  { name: 'Latur',                     pin: 413512 },
  { name: 'Mumbai City',               pin: 400008 },
  { name: 'Mumbai Suburban',           pin: 400050 },
  { name: 'Nagpur',                    pin: 440001 },
  { name: 'Nanded',                    pin: 431601 },
  { name: 'Nandurbar',                 pin: 425412 },
  { name: 'Nashik',                    pin: 422001 },
  { name: 'Palghar',                   pin: 401404 },
  { name: 'Parbhani',                  pin: 431401 },
  { name: 'Pune',                      pin: 411001 },
  { name: 'Raigad',                    pin: 402201 },
  { name: 'Ratnagiri',                 pin: 415612 },
  { name: 'Sangli',                    pin: 416416 },
  { name: 'Satara',                    pin: 415001 },
  { name: 'Sindhudurg',                pin: 416812 },
  { name: 'Solapur',                   pin: 413001 },
  { name: 'Thane',                     pin: 400601 },
  { name: 'Wardha',                    pin: 442001 },
  { name: 'Washim',                    pin: 444505 },
  { name: 'Yavatmal',                  pin: 445001 }
];

/**
 * Districts that get a district administrator, and whose assistant-doctor pairs
 * are listed in the credentials file. One per region of the state — Pune
 * (western), Nagpur (Vidarbha), Mumbai City (Konkan) and Chhatrapati
 * Sambhajinagar (Marathwada) — so a demonstration can move across Maharashtra
 * rather than staying in one corner of it.
 */
export const MH_SHOWCASE_DISTRICTS = ['Pune', 'Nagpur', 'Mumbai City', 'Chhatrapati Sambhajinagar'];

export const MH_MALE_FIRST_NAMES = [
  'Aditya', 'Ajinkya', 'Akshay', 'Amol', 'Aniket', 'Ashish', 'Atul', 'Chetan',
  'Dattatray', 'Ganesh', 'Harshal', 'Hemant', 'Jayant', 'Kedar', 'Mahesh',
  'Makarand', 'Mangesh', 'Milind', 'Mukund', 'Nikhil', 'Nilesh', 'Omkar',
  'Pandurang', 'Parag', 'Prasad', 'Pravin', 'Rahul', 'Rajendra', 'Sachin',
  'Sagar', 'Sameer', 'Sandip', 'Santosh', 'Shrikant', 'Siddharth', 'Sunil',
  'Swapnil', 'Tanmay', 'Tushar', 'Uday', 'Vaibhav', 'Vinayak', 'Vishal', 'Yogesh'
];

export const MH_FEMALE_FIRST_NAMES = [
  'Aarti', 'Ashwini', 'Bhagyashree', 'Deepali', 'Gauri', 'Jyoti', 'Kalyani',
  'Ketaki', 'Madhuri', 'Manasi', 'Meenakshi', 'Mrunal', 'Neha', 'Pallavi',
  'Pooja', 'Prajakta', 'Pranali', 'Priyanka', 'Rajashri', 'Rupali', 'Sayali',
  'Shital', 'Shraddha', 'Shubhangi', 'Snehal', 'Sonali', 'Supriya', 'Swati',
  'Tejaswini', 'Vaishali', 'Varsha', 'Vrushali'
];

export const MH_SURNAMES = [
  'Apte', 'Bhosale', 'Borse', 'Chavan', 'Deshmukh', 'Deshpande', 'Dhole',
  'Gaikwad', 'Gokhale', 'Jadhav', 'Joshi', 'Kadam', 'Kale', 'Kamble',
  'Kulkarni', 'Mane', 'Mhatre', 'More', 'Naik', 'Paranjpe', 'Patil', 'Pawar',
  'Raut', 'Salunkhe', 'Sawant', 'Shinde', 'Sonawane', 'Thorat', 'Wagh', 'Wankhede'
];

/**
 * Village name forms. Budruk and Khurd are the paired "greater" and "lesser"
 * halves of a divided village, a distinctively Maharashtrian convention; Pada
 * and Tanda are the hamlet and Banjara-settlement forms of the tribal belts.
 */
export const MH_VILLAGE_SUFFIXES = [
  'Budruk', 'Khurd', 'Wadi', 'Gaon', 'Pada', 'Tanda', 'Nagar', 'Peth', 'Khed', 'Wada'
];

export const MH_LANDMARKS = [
  'the gram panchayat office', 'the Zilla Parishad school', 'the ST bus stand',
  'the Hanuman temple', 'the hand pump', 'the anganwadi centre'
];

/** Weighted toward Marathi, as a Maharashtra clinic roster would be. */
export const MH_LANGUAGES = ['Marathi', 'Marathi', 'Marathi', 'Hindi', 'English'];
