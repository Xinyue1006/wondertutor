import { prisma } from '../config/prisma.js'

// Shared by every role: each user only ever sees their own notifications (bell icon in the top bar)
export async function listNotifications(req, res) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
  ])
  res.json({ unread, notifications: items })
}

export async function markRead(req, res) {
  await prisma.notification.updateMany({ where: { id: Number(req.params.id), userId: req.user.id }, data: { isRead: true } })
  res.json({ ok: true })
}

export async function markAllRead(req, res) {
  await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } })
  res.json({ ok: true })
}
