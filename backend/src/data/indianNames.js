/**
 * Name pools for demo record generation.
 *
 * Every record built from these is written with is_demo = true and is listed
 * by `npm run inspect`. Nothing here is a real person; the surnames and given
 * names are common across North India and are combined at random, so any
 * resemblance to an actual individual is coincidental.
 */

export const MALE_FIRST_NAMES = [
  'Aarav', 'Aditya', 'Ajay', 'Akhilesh', 'Amit', 'Anil', 'Ankit', 'Anurag',
  'Arjun', 'Ashok', 'Balram', 'Bhupendra', 'Chandan', 'Deepak', 'Devendra',
  'Dhruv', 'Dinesh', 'Gaurav', 'Girish', 'Gopal', 'Harish', 'Hemant',
  'Himanshu', 'Ishaan', 'Jagdish', 'Jitendra', 'Kailash', 'Karan', 'Kartik',
  'Kishore', 'Krishna', 'Lalit', 'Madhav', 'Mahesh', 'Manish', 'Manoj',
  'Mohan', 'Mukesh', 'Naveen', 'Nikhil', 'Nitin', 'Om Prakash', 'Pankaj',
  'Pramod', 'Prashant', 'Praveen', 'Rahul', 'Rajeev', 'Rajesh', 'Rakesh',
  'Ramesh', 'Ranjan', 'Ravi', 'Rohit', 'Sachin', 'Sandeep', 'Sanjay',
  'Satish', 'Saurabh', 'Shailendra', 'Shivam', 'Shyam', 'Sunil', 'Suresh',
  'Tarun', 'Umesh', 'Vijay', 'Vikas', 'Vinod', 'Vivek', 'Yogesh'
];

export const FEMALE_FIRST_NAMES = [
  'Aarti', 'Alka', 'Ananya', 'Anjali', 'Anita', 'Archana', 'Asha', 'Babita',
  'Bhavna', 'Chandni', 'Deepa', 'Deepika', 'Divya', 'Gayatri', 'Geeta',
  'Indu', 'Jyoti', 'Kalpana', 'Kamla', 'Kavita', 'Khushbu', 'Kiran',
  'Lakshmi', 'Lata', 'Madhu', 'Mamta', 'Manisha', 'Meena', 'Meera', 'Namrata',
  'Neelam', 'Neha', 'Nidhi', 'Nisha', 'Pooja', 'Poonam', 'Prachi', 'Pratibha',
  'Preeti', 'Priya', 'Priyanka', 'Rachna', 'Radha', 'Rani', 'Rashmi', 'Reena',
  'Rekha', 'Renu', 'Ritu', 'Sadhna', 'Sangeeta', 'Sarita', 'Savita', 'Seema',
  'Shalini', 'Shanti', 'Sheetal', 'Shobha', 'Shweta', 'Simran', 'Sneha',
  'Sonia', 'Suman', 'Sunita', 'Swati', 'Urmila', 'Usha', 'Vandana', 'Vidya'
];

export const SURNAMES = [
  'Agarwal', 'Ahluwalia', 'Bajpai', 'Bansal', 'Bhardwaj', 'Bhatt', 'Chauhan',
  'Chaturvedi', 'Dixit', 'Dubey', 'Gautam', 'Ghosh', 'Goel', 'Gupta',
  'Jaiswal', 'Joshi', 'Kashyap', 'Katiyar', 'Khanna', 'Kumar', 'Kushwaha',
  'Maurya', 'Mehrotra', 'Mishra', 'Nigam', 'Pandey', 'Pathak', 'Patel',
  'Rastogi', 'Rathore', 'Saxena', 'Shukla', 'Singh', 'Sinha', 'Srivastava',
  'Tandon', 'Tiwari', 'Tripathi', 'Trivedi', 'Upadhyay', 'Varma', 'Verma',
  'Yadav'
];

/** Specialisations weighted toward what a rural sub-centre actually refers on. */
export const SPECIALIZATIONS = [
  'General Medicine',
  'General Medicine',
  'Paediatrics',
  'Obstetrics & Gynaecology',
  'Orthopaedics',
  'Dermatology',
  'Cardiology',
  'Pulmonology',
  'ENT',
  'Ophthalmology'
];

export const QUALIFICATIONS = {
  'General Medicine':          ['MBBS, MD (General Medicine)', 'MBBS, DNB (Medicine)'],
  'Paediatrics':               ['MBBS, MD (Paediatrics)', 'MBBS, DCH'],
  'Obstetrics & Gynaecology':  ['MBBS, MS (Obstetrics & Gynaecology)', 'MBBS, DGO'],
  'Orthopaedics':              ['MBBS, MS (Orthopaedics)', 'MBBS, D.Ortho'],
  'Dermatology':               ['MBBS, MD (Dermatology)', 'MBBS, DDVL'],
  'Cardiology':                ['MBBS, MD, DM (Cardiology)'],
  'Pulmonology':               ['MBBS, MD (Respiratory Medicine)'],
  'ENT':                       ['MBBS, MS (ENT)', 'MBBS, DLO'],
  'Ophthalmology':             ['MBBS, MS (Ophthalmology)', 'MBBS, DO']
};

export const LANGUAGES = ['Hindi', 'Awadhi', 'Bhojpuri', 'Braj', 'Bundeli', 'Urdu', 'English'];

/** Common presenting complaints at a village sub-centre. */
export const CHIEF_COMPLAINTS = [
  'Fever with chills for three days',
  'Persistent dry cough and chest tightness',
  'Loose motions since yesterday, reduced urine output',
  'Severe headache with vomiting',
  'Pain and swelling in the right knee after a fall',
  'Burning sensation while passing urine',
  'Itchy rash spreading across both forearms',
  'Breathlessness on climbing stairs',
  'Abdominal pain in the lower right side',
  'Wound on the left foot not healing for two weeks',
  'Weakness and dizziness while standing up',
  'Chest discomfort radiating to the left arm',
  'Blurred vision in the right eye for a week',
  'Swelling in both ankles by evening',
  'Ear pain with reduced hearing on one side'
];

export const SYMPTOM_DURATIONS = [
  '1 day', '2 days', '3 days', '5 days', '1 week', '2 weeks', '1 month'
];
