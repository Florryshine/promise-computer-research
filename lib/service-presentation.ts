export type ServicePresentation = { icon:string; details:string[] };

const presentation:Record<string,ServicePresentation> = {
  'jamb-services': {icon:'📘',details:['Choose the JAMB service you need','Send your details to PCR on WhatsApp','Manual service — price and next steps confirmed by admin']},
  'jamb-original-result-printing': {icon:'📘',details:['Manual processing by PCR','Provide your JAMB registration number, exam year and any required supporting details.']},
  
  'jamb-admission-letter-printing': {icon:'📄',details:['Manual processing by PCR','Provide your JAMB registration number, exam year and any required supporting details.']},
  
  'jamb-admission-status-checking': {icon:'🔎',details:['Manual assistance checking your JAMB admission status','Provide your JAMB registration number and exam year.']},
  'jamb-reprinting': {icon:'🖨️',details:['Manual processing by PCR','Provide your JAMB registration number and the document you need reprinted.']},
  'jamb-olevel-screenshot': {icon:'📸',details:['₦1,000 service price']},
  'jamb-email-phone-screenshot': {icon:'📱',details:['₦1,000 service price']},
  'jamb-profile-code-retrieval': {icon:'🔑',details:['₦1,000 service price']},
  'jamb-registration-number-retrieval': {icon:'🔎',details:['₦1,000 service price']},
  'jamb-indemnity-form': {icon:'🖨️',details:['₦1,000 service price']},
  'waec-digital-certificate': {icon:'🎓',details:['₦15,000 service price']},
  'waec-original-certificate': {icon:'📜',details:['Requirements and pricing confirmed on request']},
  'waec-examination-number-retrieval': {icon:'🔎',details:['Requirements and pricing confirmed on request']},
  'waec-scratch-card': {icon:'🎫',details:['Legacy manual PIN listing; use the automatic Exam PIN service instead.']},
  'neco-scratch-card': {icon:'🎫',details:['Legacy manual PIN listing; use the automatic Exam PIN service instead.']},
  'nabteb-scratch-card': {icon:'🎫',details:['Legacy manual PIN listing; use the automatic Exam PIN service instead.']},
  'dstv-subscription': {icon:'📺',details:['Enter your smartcard number','Choose a live DStv bouquet or renew current bouquet','5% service charge']},
  'gotv-subscription': {icon:'📺',details:['Select your package and enter your details','Choose your package','5% service charge']},
  'startimes-subscription': {icon:'📺',details:['Select your package and enter your details','Choose your package','5% service charge']},
  'electricity-bill': {icon:'⚡',details:['Enter your meter details','Supported meter types','Enter payment amount','5% service charge']},
  'airtime-recharge': {icon:'📱',details:['Select your network and recipient phone number','Enter airtime amount','Automatic Pairgate fulfilment after payment','3% service charge']},
  'data-subscription': {icon:'📶',details:['Select network and data plan','Enter the recipient phone number','Automatic Pairgate fulfilment after payment','5% service charge']},
  'exam-pins': {icon:'🎫',details:['Choose WAEC, NECO or NABTEB and quantity','PINs delivered after Pairgate completes processing','5% service charge']},
  'data-pins': {icon:'📲',details:['Choose network, denomination and quantity','PINs delivered after Pairgate completes processing','5% service charge']},
  'post-utme-screening': {icon:'🎓',details:['Institution-specific pricing','Online screening assistance','WhatsApp support']},
  'school-fees-acceptance-gst-ent': {icon:'💳',details:['School fee assistance','Acceptance fee processing','GST/ENT payments']},
  'course-registration-clearance': {icon:'📝',details:['Course registration support','Online clearance','Portal assistance']},
  'nerd-registration': {icon:'⏳',details:['Coming soon']},
  'state-of-origin-birth-certificate': {icon:'🪪',details:['Discuss requirements on WhatsApp']},
  'assignments': {icon:'📚',details:['Contact on WhatsApp for requirements and pricing']},
  'final-year-project': {icon:'💻',details:['Contact on WhatsApp for requirements and pricing']},
  'transcript-certificate': {icon:'📄',details:['Contact on WhatsApp for requirements and pricing']},
  'property-services': {icon:'🏠',details:['Property enquiries','Buying support','Selling support']},
};

export function getServicePresentation(slug:string, category:string):ServicePresentation {
  return presentation[slug] ?? {
    icon: category === 'JAMB' ? '📘' : category === 'Examinations' ? '🎓' : '🛠️',
    details: ['Submit your request for processing.']
  };
}
