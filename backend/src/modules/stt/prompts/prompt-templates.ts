/**
 * Prompt Engineering Templates for OpenAI Realtime API
 *
 * These prompts are engineered to maximize transcription accuracy
 * for domain-specific terminology and context.
 */

export interface PromptTemplate {
  name: string;
  description: string;
  instructions: string;
  transcriptionGuidance: string;
}

/**
 * Church/Religious Service Prompt
 * Optimized for Korean church services, sermons, and worship
 */
export const CHURCH_SERVICE_PROMPT: PromptTemplate = {
  name: 'Church Service',
  description: 'Korean church service with religious terminology',
  instructions: `You are transcribing a live Korean church service from The Church of Jesus Christ of the Latter-day Saints (예수그리스도 휴기성도 교회).

Context:
- Religious service with sermons, prayers, and hymns
- Contains biblical references and religious terminology
- Formal Korean language with honorifics
- May include scripture readings and testimonies

Transcription Guidelines:
- Maintain accurate spelling of religious terms and proper nouns
- Preserve formal speech patterns and honorifics
- Capture scripture references accurately
- Distinguish between different speakers (pastor, congregation, etc.)`,

  transcriptionGuidance: 'Focus on accurate transcription of Korean religious terminology including: 예수그리스도, 휴기성도, 교회, 신앙, 성경, 기도, 찬양, 축복, 은혜, 주님, 하나님, 성령, 구원, 영생, 천국'
};

/**
 * Medical Consultation Prompt
 * Optimized for medical terminology and patient-doctor conversations
 */
export const MEDICAL_PROMPT: PromptTemplate = {
  name: 'Medical Consultation',
  description: 'Medical consultations with clinical terminology',
  instructions: `You are transcribing a medical consultation in Korean.

Context:
- Doctor-patient conversation
- Medical terminology and drug names
- Diagnosis and treatment discussions
- May include technical medical terms

Transcription Guidelines:
- Accurately capture medical terms and drug names
- Preserve patient symptoms and doctor's instructions
- Maintain privacy and sensitivity in transcription
- Capture both Korean and Latin medical terms`,

  transcriptionGuidance: 'Pay attention to medical terminology, disease names, medication names, anatomical terms, and clinical procedures'
};

/**
 * Legal Consultation Prompt
 * Optimized for legal terminology and formal language
 */
export const LEGAL_PROMPT: PromptTemplate = {
  name: 'Legal Consultation',
  description: 'Legal consultations and proceedings',
  instructions: `You are transcribing a legal consultation or proceeding in Korean.

Context:
- Legal terminology and statute references
- Formal language and legal jargon
- Contract discussions and legal advice
- May include case law references

Transcription Guidelines:
- Accurately transcribe legal terms and statute numbers
- Preserve formal legal language
- Capture contract clauses and legal obligations
- Maintain precision in legal terminology`,

  transcriptionGuidance: 'Focus on legal terminology including: 법률, 조항, 계약, 소송, 판례, 변호사, 검사, 판사, 법원, 민법, 형법, 상법'
};

/**
 * Business Meeting Prompt
 * Optimized for corporate and business conversations
 */
export const BUSINESS_MEETING_PROMPT: PromptTemplate = {
  name: 'Business Meeting',
  description: 'Corporate meetings and business discussions',
  instructions: `You are transcribing a business meeting in Korean.

Context:
- Professional business conversation
- May include financial terms and metrics
- Strategic discussions and decisions
- Mix of Korean and English business terms

Transcription Guidelines:
- Capture both Korean and English business terminology
- Preserve numerical data and percentages accurately
- Identify action items and decisions
- Maintain professional language`,

  transcriptionGuidance: 'Focus on business terminology, company names, financial metrics, project names, and English loanwords commonly used in Korean business'
};

/**
 * Technical/IT Discussion Prompt
 * Optimized for software development and technical conversations
 */
export const TECH_IT_PROMPT: PromptTemplate = {
  name: 'Technical Discussion',
  description: 'Software development and IT discussions',
  instructions: `You are transcribing a technical discussion about software development in Korean.

Context:
- Software engineering conversation
- Programming languages and frameworks
- Technical architecture discussions
- Mix of Korean and English technical terms

Transcription Guidelines:
- Accurately transcribe programming terms and framework names
- Preserve technical acronyms and abbreviations
- Capture code-related discussions
- Maintain English technical terms as spoken`,

  transcriptionGuidance: 'Focus on programming languages, framework names, technical concepts, API names, database terms, and development methodologies'
};

/**
 * Education/Lecture Prompt
 * Optimized for educational content and lectures
 */
export const EDUCATION_PROMPT: PromptTemplate = {
  name: 'Educational Lecture',
  description: 'Academic lectures and educational content',
  instructions: `You are transcribing an educational lecture in Korean.

Context:
- Academic lecture or classroom teaching
- Subject-specific terminology
- Educational explanations and examples
- May include Q&A sessions

Transcription Guidelines:
- Capture educational terminology accurately
- Preserve explanations and examples
- Distinguish between instructor and student speech
- Maintain academic language precision`,

  transcriptionGuidance: 'Focus on subject-specific terminology, academic concepts, and educational vocabulary'
};

/**
 * General Conversation Prompt
 * Default prompt for general-purpose transcription
 */
export const GENERAL_PROMPT: PromptTemplate = {
  name: 'General Conversation',
  description: 'General purpose Korean conversation',
  instructions: `You are transcribing a general Korean conversation.

Context:
- Natural everyday conversation
- Mixed formal and informal language
- May include various topics

Transcription Guidelines:
- Capture natural speech patterns
- Preserve both formal and informal language
- Maintain speaker context
- Accurately transcribe proper nouns`,

  transcriptionGuidance: 'Provide accurate transcription of natural Korean speech with attention to context and speaker intent'
};

/**
 * Prompt Template Registry
 */
export const PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  church: CHURCH_SERVICE_PROMPT,
  medical: MEDICAL_PROMPT,
  legal: LEGAL_PROMPT,
  business: BUSINESS_MEETING_PROMPT,
  tech: TECH_IT_PROMPT,
  education: EDUCATION_PROMPT,
  general: GENERAL_PROMPT
};

/**
 * Get a prompt template by name
 */
export function getPromptTemplate(name: string): PromptTemplate {
  return PROMPT_TEMPLATES[name] || GENERAL_PROMPT;
}

/**
 * Create a custom prompt template
 */
export function createCustomPrompt(
  name: string,
  description: string,
  context: string,
  keyTerms: string[]
): PromptTemplate {
  return {
    name,
    description,
    instructions: `You are transcribing a Korean conversation.

Context:
${context}

Transcription Guidelines:
- Maintain accuracy and context awareness
- Preserve proper nouns and specialized terminology
- Capture natural speech patterns`,
    transcriptionGuidance: `Focus on accurate transcription with attention to: ${keyTerms.join(', ')}`
  };
}
