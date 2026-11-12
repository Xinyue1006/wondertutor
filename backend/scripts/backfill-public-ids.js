import 'dotenv/config'
import { prisma } from '../src/config/prisma.js'
import { backfillPublicIds } from '../src/services/publicIds.service.js'

try {
  const counts = await backfillPublicIds()
  console.log('Public reference backfill completed:', counts)
} finally {
  await prisma.$disconnect()
}
