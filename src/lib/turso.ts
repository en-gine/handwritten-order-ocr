// src/lib/turso.ts
import { PrismaClient } from '@prisma/client'
import { LRUCache } from 'lru-cache'

/**
 * Service database Prisma client for tenant metadata.
 * This client connects to the service database which stores tenant metadata.
 */
let servicePrismaClient: PrismaClient | null = null

/**
 * Get Prisma Client for service database (tenant metadata).
 * Lazy initialization with singleton pattern.
 *
 * @returns PrismaClient instance connected to service database
 */
export function getServicePrismaClient(): PrismaClient {
  if (!servicePrismaClient) {
    const SERVICE_DATABASE_URL = process.env.SERVICE_DATABASE_URL

    if (!SERVICE_DATABASE_URL) {
      throw new Error('SERVICE_DATABASE_URL environment variable not configured')
    }

    servicePrismaClient = new PrismaClient({
      datasources: {
        db: {
          url: SERVICE_DATABASE_URL,
        },
      },
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    })
  }

  return servicePrismaClient
}

// Cache up to 100 active tenant connections, evict after 5 minutes idle
const prismaClientCache = new LRUCache<string, PrismaClient>({
  max: 100,
  ttl: 1000 * 60 * 5, // 5 minutes
  dispose: (client: PrismaClient) => {
    client.$disconnect().catch(console.error)
  },
})

/**
 * Get or create a Prisma Client for a tenant's database.
 * Clients are cached with LRU eviction (max 100 tenants, 5-minute TTL).
 *
 * @param tenantId - Unique tenant identifier
 * @param databaseUrl - Turso database URL for this tenant
 * @returns PrismaClient instance connected to tenant's database
 */
export function getTenantPrismaClient(tenantId: string, databaseUrl: string): PrismaClient {
  const cached = prismaClientCache.get(tenantId)
  if (cached) {
    return cached
  }

  const client = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

  prismaClientCache.set(tenantId, client)
  return client
}

/**
 * Disconnect all cached tenant Prisma Clients and service client.
 * For cleanup on graceful shutdown.
 */
export async function disconnectAllTenants() {
  const clients = Array.from(prismaClientCache.values())
  await Promise.all(clients.map((client) => client.$disconnect()))
  prismaClientCache.clear()

  // Disconnect service client if initialized
  if (servicePrismaClient) {
    await servicePrismaClient.$disconnect()
    servicePrismaClient = null
  }
}
