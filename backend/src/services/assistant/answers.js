// Server-written answers for account-specific questions.
//
// WHY: a language model can phrase things fluently but it can also state a date, an amount, a status or a trend that no
// record supports. Pattern-matching its text after the fact can never prove a sentence true. So the facts in the answer
// are NOT written by the model. Each tool that returns account data also records a small, validated EVIDENCE object
// (ids replaced by conversation references, values taken straight from the database result). The sentences below are
// built from that evidence only, in English, Malay or Chinese, and every number is tied to its own child, booking,
// period or tutor by construction.
//
// The model's free text is only used when NO account evidence exists for the turn (greetings, "what can you do",
// a clarifying question) and only after screenModelProse() finds nothing that looks like an account fact.
// See "Remaining limitations" in docs/AI_ASSISTANT.md.

// ───────────── language ─────────────
const MS_WORDS = /\b(saya|anak|bayar|bayaran|bila|tuisyen|berapa|yuran|kelas|guru|cikgu|minggu|bulan|esok|boleh|tolong|carikan|aduan|pelajaran|kerja rumah|apa|dan|untuk|ada)\b/i

export function detectLanguage(text) {
  const t = String(text || '')
  if (/[㐀-鿿]/.test(t)) return 'zh'
  if (MS_WORDS.test(t)) return 'ms'
  return 'en'
}

// ───────────── labels ─────────────
const STATUS = {
  en: { PENDING: 'pending', COUNTER_OFFERED: 'counter-offered', AWAITING_PAYMENT: 'awaiting payment', CONFIRMED: 'confirmed', COMPLETED: 'completed', REJECTED: 'rejected', CANCELLED: 'cancelled', DISPUTED: 'disputed', OPEN: 'open', IN_PROGRESS: 'in progress', RESOLVED: 'resolved', DISMISSED: 'dismissed', APPROVED: 'approved', PAID: 'paid', REFUNDED: 'refunded', PARTIALLY_REFUNDED: 'partially refunded', FAILED: 'failed' },
  ms: { PENDING: 'menunggu', COUNTER_OFFERED: 'tawaran balas', AWAITING_PAYMENT: 'menunggu bayaran', CONFIRMED: 'disahkan', COMPLETED: 'selesai', REJECTED: 'ditolak', CANCELLED: 'dibatalkan', DISPUTED: 'dipertikaikan', OPEN: 'terbuka', IN_PROGRESS: 'dalam proses', RESOLVED: 'diselesaikan', DISMISSED: 'ditolak', APPROVED: 'diluluskan', PAID: 'dibayar', REFUNDED: 'dikembalikan', PARTIALLY_REFUNDED: 'dikembalikan sebahagian', FAILED: 'gagal' },
  zh: { PENDING: '待处理', COUNTER_OFFERED: '已还价', AWAITING_PAYMENT: '待付款', CONFIRMED: '已确认', COMPLETED: '已完成', REJECTED: '已拒绝', CANCELLED: '已取消', DISPUTED: '有争议', OPEN: '待处理', IN_PROGRESS: '处理中', RESOLVED: '已解决', DISMISSED: '已驳回', APPROVED: '已批准', PAID: '已付款', REFUNDED: '已退款', PARTIALLY_REFUNDED: '部分退款', FAILED: '失败' },
}
const status = (l, s) => STATUS[l][s] ?? String(s).toLowerCase().replace(/_/g, ' ')
const MODE = { en: { ONLINE: 'online', PHYSICAL: 'physical' }, ms: { ONLINE: 'dalam talian', PHYSICAL: 'bersemuka' }, zh: { ONLINE: '线上', PHYSICAL: '线下' } }
const rm = (n) => `RM${Number(n).toFixed(2)}`
const plural = (n, one, many) => (n === 1 ? one : many)

// ───────────── templates (one block per language) ─────────────
// Each function returns one or more lines. [[x_n]] tokens are shown by the app as the real names it resolved itself.
const T = {
  en: {
    childrenNone: () => ["You don't have any child profiles yet."],
    children: (e) => [`You have ${e.items.length} child profile${plural(e.items.length, '', 's')}:`, ...e.items.map((c) => `• [[${c.childRef}]]: ${c.gradeLabel}${c.subjects.length ? `; subjects: ${c.subjects.join(', ')}` : ''}${c.language ? `; language: ${c.language}` : ''}${c.goals ? `; goals: ${c.goals}` : ''}${c.preferences ? `; learning preferences: ${c.preferences}` : ''}`)],
    bookingsNone: () => ["I couldn't find any lessons matching that in your records."],
    bookings: (e) => [`I found ${e.items.length} lesson${plural(e.items.length, '', 's')} in your records${e.count > e.items.length ? ` (showing ${e.items.length})` : ''}:`,
      ...e.items.slice(0, 5).map((b) => `• ${b.subject} for [[${b.childRef}]] with [[${b.tutorRef}]] on ${b.date} at ${b.time} (${MODE.en[b.mode]}, ${status('en', b.status)}${b.hourlyPrice != null ? `, ${rm(b.hourlyPrice)}/hour` : ''})`)],
    lesson: (e) => {
      const l = [`${e.subject} lesson for [[${e.childRef}]] with [[${e.tutorRef}]] on ${e.date} at ${e.time}: ${status('en', e.status)}, ${MODE.en[e.mode]}.`]
      l.push(e.checkInTime ? `The tutor's check-in was recorded at ${e.checkInTime}${e.checkOutTime ? ` and check-out at ${e.checkOutTime}` : ''}.` : e.mode === 'ONLINE' && e.attendanceRecorded == null ? 'No online check-in record is available for this lesson.' : 'No check-in is recorded for this lesson.')
      l.push(e.hasSummary ? 'The tutor has submitted a lesson summary; it is shown below.' : 'The tutor has not submitted a lesson summary for this lesson.')
      return l
    },
    progress: (e) => e.lessons === 0
      ? [`There are no completed lessons recorded for [[${e.childRef}]] ${e.periodText}.`]
      : [`For [[${e.childRef}]] ${e.periodText}: ${e.lessons} completed lesson${plural(e.lessons, '', 's')} (${e.hours} ${e.hours === 1 ? 'hour' : 'hours'}), ${e.summaries} with a tutor summary and ${e.homeworkSet} with homework recorded.`,
        'These are counts of recorded lessons and what the tutor wrote, not marks or a measure of improvement. The tutor\'s notes are shown below.'],
    payments: (e) => [`${e.periodLabel}: ${rm(e.paid)} paid in ${e.paidCount} payment${plural(e.paidCount, '', 's')}, and ${rm(e.pending)} waiting for payment in ${e.pendingCount} booking${plural(e.pendingCount, '', 's')}.`,
      'Paid amounts are not reduced by refunds; refund requests are listed separately below.'],
    refundsNone: () => ["I couldn't find any paid lessons or refund requests matching that."],
    refunds: (e) => [`I found ${e.items.length} payment${plural(e.items.length, '', 's')} with their refund status:`,
      ...e.items.slice(0, 5).map((p) => `• ${p.subject} on ${p.lessonDate}: ${rm(p.amount)} (${status('en', p.status)})${p.refunds.length ? `; refund ${p.refunds.map((r) => `${rm(r.amount)} ${status('en', r.status)}`).join(', ')}` : '; no refund request'}`),
      'A refund status is the record in WonderTutor, not proof that money has reached your account.'],
    complaintsNone: () => ["I couldn't find any complaints matching that."],
    complaints: (e) => [`You have ${e.items.length} complaint${plural(e.items.length, '', 's')} matching that:`, ...e.items.slice(0, 5).map((c) => `• ${c.category}, filed ${c.filedDate}: ${status('en', c.status)}`)],
    notifications: (e) => [`You have ${e.unread} unread notification${plural(e.unread, '', 's')}. The latest ones are shown below.`],
    tutorsNone: () => ['No tutors match these criteria yet. Try removing a preference such as budget, days or area.'],
    tutors: (e) => [`I found ${e.total} matching tutor${plural(e.total, '', 's')}${e.top.length ? '. Top results:' : '.'}`,
      ...e.top.slice(0, 3).map((t, i) => `${i + 1}. [[${t.tutorRef}]]: ${t.score}% compatibility${t.verified ? ', verified' : ''}`),
      'The match % is a compatibility score from fixed rules, not a prediction of results. Verified tutors are listed first.'],
    match: (e) => [`[[${e.tutorRef}]] is ranked ${e.rank} of ${e.total} with a ${e.score}% compatibility score (${e.label}). The reasons are listed below.`],
    missing: (e) => [e.reason === 'no_children' ? "You don't have any child profiles yet, so I can't look that up." : e.reason === 'invalid_range' ? 'The date range looks wrong (the start is after the end). Please give it again.' : "I couldn't find a matching record in your account for that."],
    noEvidence: () => ["I can help you look things up in WonderTutor, but I can't book, cancel, pay or change records. What would you like to check: lessons, payments, learning progress or tutors?"],
    askSubject: () => 'Which subject and education level do you need (for example Mathematics for Primary 4)?',
    askLevel: () => 'Which education level is this for (kindergarten, primary or secondary), and which grade?',
  },
  ms: {
    childrenNone: () => ['Anda belum mempunyai profil anak.'],
    children: (e) => [`Anda mempunyai ${e.items.length} profil anak:`, ...e.items.map((c) => `• [[${c.childRef}]]: ${c.gradeLabel}${c.subjects.length ? `; subjek: ${c.subjects.join(', ')}` : ''}${c.language ? `; bahasa: ${c.language}` : ''}${c.goals ? `; matlamat: ${c.goals}` : ''}${c.preferences ? `; pilihan pembelajaran: ${c.preferences}` : ''}`)],
    bookingsNone: () => ['Saya tidak menjumpai sebarang kelas yang sepadan dalam rekod anda.'],
    bookings: (e) => [`Saya menjumpai ${e.items.length} kelas dalam rekod anda${e.count > e.items.length ? ` (memaparkan ${e.items.length})` : ''}:`,
      ...e.items.slice(0, 5).map((b) => `• ${b.subject} untuk [[${b.childRef}]] bersama [[${b.tutorRef}]] pada ${b.date} jam ${b.time} (${MODE.ms[b.mode]}, ${status('ms', b.status)}${b.hourlyPrice != null ? `, ${rm(b.hourlyPrice)}/jam` : ''})`)],
    lesson: (e) => {
      const l = [`Kelas ${e.subject} untuk [[${e.childRef}]] bersama [[${e.tutorRef}]] pada ${e.date} jam ${e.time}: ${status('ms', e.status)}, ${MODE.ms[e.mode]}.`]
      l.push(e.checkInTime ? `Daftar masuk tutor direkodkan pada ${e.checkInTime}${e.checkOutTime ? ` dan daftar keluar pada ${e.checkOutTime}` : ''}.` : e.mode === 'ONLINE' && e.attendanceRecorded == null ? 'Rekod daftar masuk kelas dalam talian ini tidak tersedia.' : 'Tiada daftar masuk direkodkan untuk kelas ini.')
      l.push(e.hasSummary ? 'Tutor telah menghantar ringkasan kelas; ia dipaparkan di bawah.' : 'Tutor belum menghantar ringkasan untuk kelas ini.')
      return l
    },
    progress: (e) => e.lessons === 0
      ? [`Tiada kelas selesai direkodkan untuk [[${e.childRef}]] ${e.periodText}.`]
      : [`Untuk [[${e.childRef}]] ${e.periodText}: ${e.lessons} kelas selesai (${e.hours} jam), ${e.summaries} mempunyai ringkasan tutor dan ${e.homeworkSet} mempunyai kerja rumah direkodkan.`,
        'Ini ialah bilangan kelas yang direkodkan dan apa yang ditulis tutor, bukan markah atau ukuran peningkatan. Catatan tutor dipaparkan di bawah.'],
    payments: (e) => [`${e.periodLabel}: ${rm(e.paid)} telah dibayar dalam ${e.paidCount} bayaran, dan ${rm(e.pending)} menunggu bayaran dalam ${e.pendingCount} tempahan.`,
      'Jumlah dibayar tidak ditolak dengan bayaran balik; permintaan bayaran balik disenaraikan berasingan di bawah.'],
    refundsNone: () => ['Saya tidak menjumpai sebarang bayaran atau permintaan bayaran balik yang sepadan.'],
    refunds: (e) => [`Saya menjumpai ${e.items.length} bayaran beserta status bayaran balik:`,
      ...e.items.slice(0, 5).map((p) => `• ${p.subject} pada ${p.lessonDate}: ${rm(p.amount)} (${status('ms', p.status)})${p.refunds.length ? `; bayaran balik ${p.refunds.map((r) => `${rm(r.amount)} ${status('ms', r.status)}`).join(', ')}` : '; tiada permintaan bayaran balik'}`),
      'Status bayaran balik ialah rekod dalam WonderTutor, bukan bukti wang telah sampai ke akaun anda.'],
    complaintsNone: () => ['Saya tidak menjumpai sebarang aduan yang sepadan.'],
    complaints: (e) => [`Anda mempunyai ${e.items.length} aduan yang sepadan:`, ...e.items.slice(0, 5).map((c) => `• ${c.category}, difailkan ${c.filedDate}: ${status('ms', c.status)}`)],
    notifications: (e) => [`Anda mempunyai ${e.unread} notifikasi belum dibaca. Notifikasi terkini dipaparkan di bawah.`],
    tutorsNone: () => ['Belum ada tutor yang sepadan dengan kriteria ini. Cuba buang satu pilihan seperti bajet, hari atau kawasan.'],
    tutors: (e) => [`Saya menjumpai ${e.total} tutor yang sepadan${e.top.length ? '. Keputusan teratas:' : '.'}`,
      ...e.top.slice(0, 3).map((t, i) => `${i + 1}. [[${t.tutorRef}]]: keserasian ${t.score}%${t.verified ? ', disahkan' : ''}`),
      'Peratus padanan ialah skor keserasian berdasarkan peraturan tetap, bukan ramalan keputusan. Tutor yang disahkan disenaraikan dahulu.'],
    match: (e) => [`[[${e.tutorRef}]] berada di kedudukan ${e.rank} daripada ${e.total} dengan skor keserasian ${e.score}% (${e.label}). Sebab-sebabnya disenaraikan di bawah.`],
    missing: (e) => [e.reason === 'no_children' ? 'Anda belum mempunyai profil anak, jadi saya tidak dapat menyemaknya.' : e.reason === 'invalid_range' ? 'Julat tarikh nampaknya salah (tarikh mula selepas tarikh akhir). Sila beri semula.' : 'Saya tidak menjumpai rekod yang sepadan dalam akaun anda.'],
    noEvidence: () => ['Saya boleh membantu menyemak maklumat WonderTutor, tetapi tidak boleh menempah, membatalkan, membayar atau mengubah rekod. Apa yang anda ingin semak: kelas, bayaran, perkembangan pembelajaran atau tutor?'],
    askSubject: () => 'Subjek dan tahap pendidikan yang manakah (contohnya Matematik untuk Darjah 4)?',
    askLevel: () => 'Untuk tahap pendidikan yang mana (tadika, rendah atau menengah), dan gred berapa?',
  },
  zh: {
    childrenNone: () => ['您还没有孩子档案。'],
    children: (e) => [`您有 ${e.items.length} 个孩子档案：`, ...e.items.map((c) => `• [[${c.childRef}]]：${c.gradeLabel}${c.subjects.length ? `；科目：${c.subjects.join('、')}` : ''}${c.language ? `；语言：${c.language}` : ''}${c.goals ? `；目标：${c.goals}` : ''}${c.preferences ? `；学习偏好：${c.preferences}` : ''}`)],
    bookingsNone: () => ['在您的记录中没有找到符合条件的课程。'],
    bookings: (e) => [`在您的记录中找到 ${e.items.length} 节课${e.count > e.items.length ? `（显示 ${e.items.length} 节）` : ''}：`,
      ...e.items.slice(0, 5).map((b) => `• ${b.subject}，[[${b.childRef}]]，老师 [[${b.tutorRef}]]，${b.date} ${b.time}（${MODE.zh[b.mode]}，${status('zh', b.status)}${b.hourlyPrice != null ? `，每小时 ${rm(b.hourlyPrice)}` : ''}）`)],
    lesson: (e) => {
      const l = [`${e.date} ${e.time} 的${e.subject}课，学生 [[${e.childRef}]]，老师 [[${e.tutorRef}]]：${status('zh', e.status)}，${MODE.zh[e.mode]}。`]
      l.push(e.checkInTime ? `老师的签到时间记录为 ${e.checkInTime}${e.checkOutTime ? `，签退时间 ${e.checkOutTime}` : ''}。` : e.mode === 'ONLINE' && e.attendanceRecorded == null ? '这节线上课暂没有可用的签到记录。' : '这节课没有签到记录。')
      l.push(e.hasSummary ? '老师已提交课堂总结，详见下方。' : '老师尚未提交这节课的总结。')
      return l
    },
    progress: (e) => e.lessons === 0
      ? [`[[${e.childRef}]] ${e.periodText}没有已完成课程的记录。`]
      : [`[[${e.childRef}]] ${e.periodText}：已完成 ${e.lessons} 节课（${e.hours} 小时），其中 ${e.summaries} 节有老师总结，${e.homeworkSet} 节记录了作业。`,
        '这些是已记录课程的数量和老师写下的内容，不是成绩，也不代表进步幅度。老师的记录见下方。'],
    payments: (e) => [`${e.periodLabel}：已付款 ${rm(e.paid)}（${e.paidCount} 笔），待付款 ${rm(e.pending)}（${e.pendingCount} 个预约）。`,
      '已付款金额未扣除退款；退款申请单独列在下方。'],
    refundsNone: () => ['没有找到符合条件的付款或退款申请。'],
    refunds: (e) => [`找到 ${e.items.length} 笔付款及其退款状态：`,
      ...e.items.slice(0, 5).map((p) => `• ${p.lessonDate} ${p.subject}：${rm(p.amount)}（${status('zh', p.status)}）${p.refunds.length ? `；退款 ${p.refunds.map((r) => `${rm(r.amount)} ${status('zh', r.status)}`).join('、')}` : '；没有退款申请'}`),
      '退款状态是 WonderTutor 中的记录，并不证明款项已到账。'],
    complaintsNone: () => ['没有找到符合条件的投诉。'],
    complaints: (e) => [`找到 ${e.items.length} 条符合条件的投诉：`, ...e.items.slice(0, 5).map((c) => `• ${c.category}，提交于 ${c.filedDate}：${status('zh', c.status)}`)],
    notifications: (e) => [`您有 ${e.unread} 条未读通知，最新通知见下方。`],
    tutorsNone: () => ['目前没有符合这些条件的老师。可以试着放宽预算、日期或地区等偏好。'],
    tutors: (e) => [`找到 ${e.total} 位符合条件的老师${e.top.length ? '，排名靠前的是：' : '。'}`,
      ...e.top.slice(0, 3).map((t, i) => `${i + 1}. [[${t.tutorRef}]]：匹配度 ${t.score}%${t.verified ? '，已认证' : ''}`),
      '匹配度是按固定规则计算的契合分数，不是对学习结果的预测。已认证的老师排在前面。'],
    match: (e) => [`[[${e.tutorRef}]] 在 ${e.total} 位老师中排第 ${e.rank}，匹配度 ${e.score}%（${e.label}）。原因见下方。`],
    missing: (e) => [e.reason === 'no_children' ? '您还没有孩子档案，所以无法查询。' : e.reason === 'invalid_range' ? '日期范围似乎有误（开始日期晚于结束日期），请重新告诉我。' : '在您的账户中没有找到对应的记录。'],
    noEvidence: () => ['我可以帮你查询 WonderTutor 的信息，但不能预约、取消、付款或修改记录。你想查看课程、付款、学习进度，还是寻找老师？'],
    askSubject: () => '您需要哪个科目和年级（例如小四数学）？',
    askLevel: () => '这是哪个教育阶段（幼儿园、小学还是中学），几年级？',
  },
}

const periodText = (l, p) => {
  const range = p.from || p.to ? `${p.from ?? '…'} – ${p.to ?? '…'}` : null
  const subj = p.subject ? `${p.subject}, ` : ''
  if (l === 'zh') return `（${subj}${range ?? '全部记录'}）`
  if (l === 'ms') return `(${subj}${range ?? 'semua rekod'})`
  return `(${subj}${range ?? 'all recorded lessons'})`
}

// Builds the visible answer from the turn's evidence. Returns null when the turn produced no evidence at all.
export function composeFromEvidence(ctx, lang = 'en') {
  const t = T[lang] || T.en
  const lines = []
  for (const e of ctx.evidence) {
    switch (e.kind) {
      case 'children': lines.push(...(e.items.length ? t.children(e) : t.childrenNone())); break
      case 'bookings': lines.push(...(e.items.length ? t.bookings(e) : t.bookingsNone())); break
      case 'lesson': lines.push(...t.lesson(e)); break
      case 'progress': lines.push(...t.progress({ ...e, periodText: periodText(lang, e.period) })); break
      case 'payments': lines.push(...t.payments(e)); break
      case 'refunds': lines.push(...(e.items.length ? t.refunds(e) : t.refundsNone())); break
      case 'complaints': lines.push(...(e.items.length ? t.complaints(e) : t.complaintsNone())); break
      case 'notifications': lines.push(...t.notifications(e)); break
      case 'tutors': lines.push(...(e.total ? t.tutors(e) : t.tutorsNone())); break
      case 'match': lines.push(...t.match(e)); break
      case 'faq': lines.push(e.entries[0].answer); break // approved policy text, English only
      case 'missing': lines.push(...t.missing(e)); break
      default: break
    }
  }
  return lines.length ? lines.join('\n') : null
}

export const clarifyText = (kind, lang = 'en') => { const t = T[lang] || T.en; return kind === 'level' ? t.askLevel() : t.askSubject() }
export const noEvidenceText = (lang = 'en') => (T[lang] || T.en).noEvidence()[0]

// ───────────── model prose without evidence ─────────────
// Used only when the turn has no account evidence. The model may greet, explain what it can do, or ask a clarifying
// question, but it may not state anything that looks like an account fact. This is a conservative screen, not a proof:
// it errs on the side of replacing the text (the safe template above is then shown).
// First-person claims that WE did something ("I have booked...", "Saya sudah tempah...", "已为您预约..."). Phase 1 has no
// write tools, so such a sentence is false by definition.
const FIRST_PERSON_CLAIM = [
  /\b(i|we)(\s+have|'ve|\s+already)?\s+(booked|cancell?ed|paid|rescheduled|submitted|filed|deleted|updated|changed|marked|sent|made|created|approved|processed|refunded|confirmed|arranged|requested)\b/i,
  /\bsaya\s+(sudah|telah|dah)\s+(tempah|batal|bayar|jadual|hantar|failkan|padam|kemas kini|ubah|luluskan|proses|sahkan|kembalikan|buat)/i,
  /\b(sudah|telah|dah)\s+saya\s+(tempah|batal|bayar|hantar|padam|ubah|luluskan|proses|sahkan)/i,
  /(我已(经)?|已(经)?(为您|帮您|替您)|帮您已(经)?|替您已(经)?)(预约|订|取消|付款|支付|转账|改期|提交|删除|更新|修改|标记|批准|退款|处理|确认|通过|拒绝)/,
]
// Passive statements that something happened to the parent's account ("your refund has been approved"). These are
// legitimate when the SERVER reads them from a record, so they only matter for free model prose.
const PASSIVE_CLAIM = [
  /\b(has|have|is|are|was|were|been)\s+(now\s+)?(booked|cancell?ed|paid|rescheduled|submitted|filed|deleted|updated|marked|refunded|approved|processed|confirmed|completed|rejected|declined)\b/i,
  /\b(telah|sudah|dah)\s+(ditempah|dibatalkan|dibayar|dihantar|diluluskan|diproses|disahkan|dikembalikan|dipadam)/i,
  /(已被|已经被|已)(预约|取消|付款|支付|退款|批准|处理|确认|通过|拒绝|完成)/,
]
const WRITE_CLAIM = [...FIRST_PERSON_CLAIM, ...PASSIVE_CLAIM]
// Words that carry an account fact: money, status, time, attendance or progress. Present in three languages.
const FACT_WORDS = [
  /\b(paid|payments?|owe[sd]?|refund(?:ed|s)?|approved|rejected|declined|completed|confirmed|cancell?ed|pending|overdue|attended|absent|improv\w*|progress(?:ed)?|score[sd]?|grades?|marks?|rank(?:ed)?|balances?|invoices?|receipts?|lessons?|class(?:es)?|bookings?|homework|complaints?|notifications?|today|tomorrow|yesterday|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|august|september|october|november|december)\b/i,
  /\b(bayar\w*|dibayar|bayaran|baki|hutang|dikembalikan|diluluskan|ditolak|selesai|disahkan|dibatalkan|tertunggak|hadir|tidak hadir|lewat|meningkat|kemajuan|markah|gred|kelas|tempahan|kerja rumah|aduan|esok|hari ini|semalam|petang|malam|pagi|isnin|selasa|rabu|khamis|jumaat|sabtu|ahad)\b/i,
  /(付|款|钱|费|退|批准|通过|拒绝|完成|确认|取消|待|逾期|出勤|缺席|迟到|进步|提高|提升|退步|成绩|分数|排名|排第|余额|课|作业|投诉|通知|今天|明天|昨天|今晚|早上|下午|晚上|星期|周[一二三四五六日]|[一二三四五六七八九十]月|点钟?|号)/,
]
const DIGITS = /[\p{N}]|RM|\$|%|％/u

// Mentioning a feature in a capability statement or a clarification question is
// different from asserting an account fact. Keep status, time, amounts and write
// claims subject to the existing checks; only neutral topic nouns are removed
// from these narrowly scoped sentences before the factual-vocabulary screen.
const CAPABILITY_START = /^(?:i can (?:help|find|look up|check)|i(?:'m| am) (?:here|able) to help|saya boleh (?:bantu|membantu|cari|semak)|我可以(?:帮|協助|协助))/iu
const GUIDANCE_QUESTION = /^(?:can i (?:help|assist)|which\b|what\b|would you like\b|could you (?:tell|clarify|specify)|can you (?:tell|clarify|specify)|do you mean\b|(?:yang mana|anak mana|subjek apa|boleh (?:anda|awak|saya))\b|你想|您想|请问|請問|想要)/iu
const HELP_QUESTION = /^how (?:can|may) i (?:help|assist)(?: you)?(?: with .+)?[?？]$/iu
const GUIDANCE_TOPICS = /\b(?:lessons?|classes|bookings?|homework|complaints?|notifications?|progress|grades?|refunds?|payments?|kelas|tempahan|kerja rumah|aduan|bayaran|kemajuan|gred)\b|(?:课程|課程|功课|功課|作业|作業|付款|退款|投诉|投訴|通知|学习进度|學習進度|成绩|成績)/giu
const SOCIAL_QUESTION = /^(?:how (?:can|may) i (?:help|assist)(?: you)?(?: with (?:your )?(?:tutoring needs|wondertutor|tutoring|tutor search))?(?: today)?|how(?:'s| is) it going)[?？!！]?$/iu
const GUIDANCE_WORDS = new Set((`i i'm am can may here able to help assist you your own a an the find search look up check read view or and with for about saved recorded upcoming latest recent tutor tutors teacher teachers tutoring needs wondertutor child child's children children's profiles profile details information records subjects subject education level lessons lesson classes class bookings booking homework complaints complaint notifications notification progress grades grade refunds refund payments payment policies policy which what how would like could tell clarify specify do mean want need should is this me us today saya boleh bantu membantu cari mencari semak menyemak tutor guru atau dan kelas tempahan kerja rumah aduan bayaran kemajuan gred anda anak profil maklumat subjek yang mana awak`).split(/\s+/u))

function approvedGuidanceSentence(s) {
  // Only a vocabulary of feature descriptions/questions is admitted. An
  // appended assertion ("because your lessons are free", "; it is fractions")
  // must not inherit the allowance from an earlier capability prefix.
  if (/[:;；：]/u.test(s)) return false
  if (CAPABILITY_START.test(s) && /\b(?:is|am|are|was|were|has|have|had|be|been)\b/iu.test(s.replace(/^i(?: am|'m) (?:here|able) to\s+/iu, ''))) return false
  if (/[㐀-鿿]/u.test(s)) {
    return s.replace(/我可以|帮你|帮您|帮助|協助|协助|查询|查詢|查看|找|老师|老師|教师|教師|导师|導師|课程|課程|功课|功課|作业|作業|付款|退款|投诉|投訴|通知|学习进度|學習進度|成绩|成績|或|和|及|[、，,。.!！?？\s]/gu, '') === ''
  }
  const words = s.toLowerCase().replace(/’/gu, "'").match(/[\p{L}']+/gu) || []
  return words.length > 0 && words.every(word => GUIDANCE_WORDS.has(word))
}

function claimVocabulary(text) {
  return (text.match(/[^.!?。！？]+[.!?。！？]?/gu) || []).map(sentence => {
    const s = sentence.trim()
    if (SOCIAL_QUESTION.test(s)) return ''
    if (HELP_QUESTION.test(s) && approvedGuidanceSentence(s)) return s.replace(GUIDANCE_TOPICS, '').replace(/\btoday\b/giu, '')
    if (approvedGuidanceSentence(s) && (CAPABILITY_START.test(s) || (GUIDANCE_QUESTION.test(s) && /[?？]$/u.test(s)))) return s.replace(GUIDANCE_TOPICS, '')
    return s
  }).join(' ')
}

export function screenModelProse(text, session) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty' }
  if (text.length > 400) return { ok: false, reason: 'too_long' }
  if (WRITE_CLAIM.some((re) => re.test(text))) return { ok: false, reason: 'write_claim' }
  for (const m of text.matchAll(/\[\[([a-z]+_\d+)\]\]/g)) if (!session.refs.has(m[1])) return { ok: false, reason: 'unknown_ref' }
  if (DIGITS.test(text.replace(/\[\[[a-z]+_\d+\]\]/g, ''))) return { ok: false, reason: 'unsupported_figure' }
  if (FACT_WORDS.some((re) => re.test(claimVocabulary(text.replace(/\[\[[a-z]+_\d+\]\]/g, ''))))) return { ok: false, reason: 'unsupported_account_claim' }
  return { ok: true }
}

// Used by the evaluation harness and tests: does this text claim that a write happened?
export const claimsCompletedAction = (text) => FIRST_PERSON_CLAIM.some((re) => re.test(String(text || '')))
