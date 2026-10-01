export type ServicePresentation = { icon:string; details:string[] };

const presentation:Record<string,ServicePresentation> = {
  'jamb-original-result-portal': {icon:'📘',details:['Portal access required','₦2,500 service price']},
  'jamb-original-result-no-portal': {icon:'📘',details:['JAMB registration number','Full name and exam year','₦4,500 service price']},
  'jamb-admission-letter-portal': {icon:'📄',details:['Portal access required','₦3,000 service price']},
  'jamb-admission-letter-no-portal': {icon:'📄',details:['JAMB registration number','Full name and exam year','₦4,500 service price']},
  'jamb-reprinting': {icon:'🖨️',details:['₦1,000 service price']},
  'jamb-olevel-screenshot': {icon:'📸',details:['₦1,000 service price']},
  'jamb-email-phone-screenshot': {icon:'📱',details:['₦1,000 service price']},
  'jamb-profile-code-retrieval': {icon:'🔑',details:['₦1,000 service price']},
  'jamb-registration-number-retrieval': {icon:'🔎',details:['₦1,000 service price']},
  'jamb-indemnity-form': {icon:'🖨️',details:['₦1,000 service price']},
  'waec-digital-certificate': {icon:'🎓',details:['₦15,000 service price']},
  'waec-original-certificate': {icon:'📜',details:['Requirements and pricing confirmed on request']},
  'waec-examination-number-retrieval': {icon:'🔎',details:['Requirements and pricing confirmed on request']},
  'waec-scratch-card': {icon:'🎫',details:['₦7,000 service price']},
  'neco-scratch-card': {icon:'🎫',details:['₦3,500 service price']},
  'nabteb-scratch-card': {icon:'🎫',details:['₦2,000 service price']},
  'dstv-subscription': {icon:'📺',details:['Verify smartcard','Choose a live DStv bouquet or renew current bouquet','₦1,000 service fee']},
  'gotv-subscription': {icon:'📺',details:['Manual processing','Enter package plan','₦1,000 service charge']},
  'startimes-subscription': {icon:'📺',details:['Manual processing','Enter package plan','₦1,000 service charge']},
  'electricity-bill': {icon:'⚡',details:['IKEDC meter verification','Prepaid or postpaid','Enter payment amount','₦500 service fee']},
  'airtime-recharge': {icon:'📱',details:['Select your network and phone number','Enter airtime amount','Automatic VTpass fulfillment after payment']},
  'data-subscription': {icon:'📶',details:['Select network','Choose a live VTpass data plan','Automatic fulfillment after payment']},
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
