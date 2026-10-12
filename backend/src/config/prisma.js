import { PrismaClient } from '@prisma/client'

// One shared Prisma client for the whole app
export const prisma = new PrismaClient()
