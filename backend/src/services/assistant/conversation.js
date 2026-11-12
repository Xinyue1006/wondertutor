// Safe conversational replies do not need a personal-record lookup or an AI call.
// These are whole-message intents only: "hi, when is my next lesson?" must still
// reach the language model and its read-only tools, rather than becoming a greeting.
const clean = (value) => String(value || '').normalize('NFKC').trim().toLowerCase()
  .replace(/[!?.,，。！？、:;；：]+$/gu, '').replace(/\s+/g, ' ').trim()

const GREETING = /^(?:(?:hi|hello|hey|heyo|heya|hiya|hai|helo|hallo)(?: there)?(?: (?:bot|assistant|wondertutor|ngaw))?(?: (?:lah|la|ah))?|good (?:morning|afternoon|evening)|salam|assalamualaikum|selamat (?:pagi|tengah hari|petang|malam)|你好|您好|嗨|哈喽|早上好|下午好|晚上好)$/u
const HELP = /^(?:help(?: me)?|what can (?:you|u) do|what can i ask(?: you)?|how can (?:you|u) help(?: me)?|can (?:you|u) help(?: me)?|how do i use (?:this|the assistant|this chatbot)|who are (?:you|u)|apa yang (?:(?:anda|awak|kamu) boleh|boleh (?:anda|awak|kamu)) (?:buat|bantu)|apa boleh tanya|boleh (?:tolong|bantu)(?: saya)?|macam mana (?:nak )?guna (?:ini|chatbot)|awak siapa|你(?:是誰|是谁|能做什么|会做什么|可以做什么)|有什么可以问|可以帮我什么|帮我一下)$/u
const THANKS = /^(?:(?:ok(?:ay)?[,，]? )?(?:thanks(?: a lot)?|thank you(?: so much)?|thankyou|thx|tq)(?: (?:lah|la|ah))?|terima kasih|makasih|谢谢(?:你|您)?|多谢|谢啦)$/u

export function conversationalIntent(message) {
  const text = clean(message)
  if (!text || text.length > 100) return null
  if (GREETING.test(text)) return 'greeting'
  if (HELP.test(text)) return 'help'
  if (THANKS.test(text)) return 'thanks'
  return null
}

// The language of short greetings is often not detectable from account words.
// Keep this separate from the factual-answer language detection.
export function conversationalLanguage(message) {
  const text = clean(message)
  if (/[㐀-鿿]/u.test(text)) return 'zh'
  if (/^(?:hai|helo|salam|assalamualaikum|selamat|terima kasih|makasih|apa |boleh |macam mana |awak siapa)/u.test(text)) return 'ms'
  return 'en'
}

const TEXT = {
  en: {
    greeting: "Hi! I'm WonderTutor's assistant. I can help you find a tutor or check your lessons, homework and payments. What would you like help with?",
    again: "Hello again! What would you like help with? You can ask your own question or choose an example below.",
    help: "Tell me what you need in your own words. I can find tutors, look up your lessons and homework, check payments or complaints, and explain WonderTutor policies. I can look things up, but changes such as booking or paying are completed on the normal pages.",
    thanks: "You're welcome! Is there anything else you'd like to check?",
  },
  ms: {
    greeting: 'Hai! Saya pembantu WonderTutor. Saya boleh membantu mencari tutor atau menyemak kelas, kerja rumah dan bayaran anda. Apa yang anda perlukan?',
    again: 'Hai lagi! Apa yang anda ingin semak? Anda boleh taip soalan sendiri atau pilih contoh di bawah.',
    help: 'Beritahu saya apa yang anda perlukan. Saya boleh mencari tutor, menyemak kelas, kerja rumah, bayaran dan aduan, serta menerangkan polisi WonderTutor. Tindakan seperti tempahan atau pembayaran dibuat di halaman biasa.',
    thanks: 'Sama-sama! Ada perkara lain yang anda ingin semak?',
  },
  zh: {
    greeting: '你好！我是 WonderTutor 助手。我可以帮你找老师，或查看课程、作业和付款记录。有什么想了解的？',
    again: '又见面了！这次想了解什么？你可以直接输入问题，或选择下面的示例。',
    help: '直接告诉我你需要什么就可以。我可以帮你找老师、查看课程和作业、查询付款或投诉，以及解释 WonderTutor 的使用政策。预约、付款等操作需要在相应页面完成。',
    thanks: '不客气！还有什么想查询的吗？',
  },
}

export function conversationalReply(intent, lang = 'en', { returning = false } = {}) {
  const text = TEXT[lang] || TEXT.en
  return intent === 'greeting' && returning ? text.again : text[intent] || text.help
}

export const QUESTIONS = {
  en: {
    lesson: 'When is my next lesson?',
    homework: 'What homework was given in the latest lesson?',
    payments: 'How much have I paid this month?',
    matching: 'Find a Maths tutor for Primary 4',
    refunds: 'What is the status of my refund requests?',
    policies: 'How do refunds work?',
    progress: "Show my child's learning progress",
    matchWhy: 'Why is the first tutor recommended?',
    online: 'Find online tutors instead',
  },
  ms: {
    lesson: 'Bila kelas saya seterusnya?',
    homework: 'Apa kerja rumah daripada kelas terakhir?',
    payments: 'Berapa yang saya bayar bulan ini?',
    matching: 'Carikan tutor Matematik untuk Darjah 4',
    refunds: 'Apakah status permohonan bayaran balik saya?',
    policies: 'Bagaimana bayaran balik dibuat?',
    progress: 'Tunjukkan perkembangan pembelajaran anak saya',
    matchWhy: 'Mengapa tutor pertama disyorkan?',
    online: 'Carikan tutor dalam talian',
  },
  zh: {
    lesson: '我下一节课是什么时候？',
    homework: '最近一节课有什么作业？',
    payments: '这个月我付了多少钱？',
    matching: '帮我找小四数学老师',
    refunds: '我的退款申请是什么状态？',
    policies: '退款规则是怎样的？',
    progress: '查看孩子的学习进度',
    matchWhy: '为什么推荐第一位老师？',
    online: '帮我改找线上老师',
  },
}

// Suggestions are product-owned questions, never generated record claims, names
// or actions. Context only selects from the reviewed list; no private text enters it.
export function suggestedQuestions(lang = 'en', { evidence = [], needs = null, clarification = null } = {}) {
  if (needs || clarification) return []
  const questions = QUESTIONS[lang] || QUESTIONS.en
  const kinds = new Set(evidence.map(e => e.kind))
  const keys = kinds.has('tutors') || kinds.has('match')
    ? [evidence.some(e => e.kind === 'match' || (e.kind === 'tutors' && e.total > 0)) ? 'matchWhy' : 'online', 'lesson', 'payments', 'policies']
    : kinds.has('payments') || kinds.has('refunds')
      ? ['refunds', 'policies', 'lesson', 'matching']
      : kinds.has('bookings') || kinds.has('lesson') || kinds.has('progress')
        ? ['homework', 'progress', 'payments', 'matching']
        : ['lesson', 'homework', 'payments', 'matching']
  return keys.map(key => questions[key])
}
