// src/services/review-cleanup.service.ts
/**
 * Review Session Timeout Cleanup Service (T056d)
 *
 * Background job that runs every 5 minutes to clean up abandoned review sessions.
 * If a review has been in_progress for more than 30 minutes without activity,
 * it will be reset to pending status to allow other operators to claim it.
 */

import type { PrismaClient } from '@prisma/client'

/**
 * Cleanup abandoned review sessions.
 *
 * Finds review queue items that are:
 * - Status: in_progress
 * - lastActivityAt: more than 30 minutes ago
 *
 * Resets them to:
 * - Status: pending
 * - assignedOperator: null
 * - Preserves draft data for resumption
 *
 * @param db - Prisma client (tenant database)
 * @param tenantId - Tenant ID for filtering
 * @param timeoutMinutes - Inactivity timeout in minutes (default 30)
 * @returns Number of sessions cleaned up
 */
export async function cleanupAbandonedReviews(
  db: PrismaClient,
  tenantId: string,
  timeoutMinutes: number = 30
): Promise<number> {
  // Calculate timeout threshold (current time - 30 minutes)
  const timeoutThreshold = new Date(Date.now() - timeoutMinutes * 60 * 1000)

  console.log(
    `[Review Cleanup] Checking for abandoned reviews (timeout threshold: ${timeoutThreshold.toISOString()})`
  )

  // Find abandoned review sessions
  const abandonedReviews = await db.reviewQueue.findMany({
    where: {
      tenantId,
      reviewStatus: 'in_progress',
      lastActivityAt: {
        lt: timeoutThreshold, // Less than 30 minutes ago
      },
    },
  })

  if (abandonedReviews.length === 0) {
    console.log('[Review Cleanup] No abandoned reviews found')
    return 0
  }

  console.log(`[Review Cleanup] Found ${abandonedReviews.length} abandoned reviews`)

  // Reset each abandoned review to pending
  for (const review of abandonedReviews) {
    await db.reviewQueue.update({
      where: { id: review.id },
      data: {
        reviewStatus: 'pending',
        assignedOperator: null,
        // Preserve draft data - operator can resume later
        // Do NOT clear draftCustomerCorrection, draftItemCorrections, draftReviewNotes
      },
    })

    console.log(
      `[Review Cleanup] Reset review ${review.orderId} (was assigned to ${review.assignedOperator}, last activity: ${review.lastActivityAt?.toISOString()})`
    )
  }

  return abandonedReviews.length
}

/**
 * Start periodic cleanup job.
 *
 * Runs cleanup every 5 minutes for all tenants.
 * This should be called once when the server starts.
 *
 * @param servicePrisma - Prisma client for service database (to fetch tenants)
 * @param getTenantPrisma - Function to get Prisma client for a tenant database
 * @param intervalMinutes - Cleanup interval in minutes (default 5)
 * @returns Interval ID (can be used to stop the job with clearInterval)
 */
export function startReviewCleanupJob(
  servicePrisma: PrismaClient,
  getTenantPrisma: (tenantId: string) => Promise<PrismaClient>,
  intervalMinutes: number = 5
): NodeJS.Timeout {
  const intervalMs = intervalMinutes * 60 * 1000

  console.log(`[Review Cleanup] Starting periodic cleanup job (interval: ${intervalMinutes} minutes)`)

  const intervalId = setInterval(async () => {
    try {
      console.log('[Review Cleanup] Running periodic cleanup...')

      // Fetch all active tenants from service database
      const tenants = await servicePrisma.tenant.findMany({
        where: { isActive: true },
      })

      console.log(`[Review Cleanup] Cleaning up ${tenants.length} tenant databases`)

      // Run cleanup for each tenant
      let totalCleaned = 0
      for (const tenant of tenants) {
        try {
          const tenantPrisma = await getTenantPrisma(tenant.id)
          const cleaned = await cleanupAbandonedReviews(tenantPrisma, tenant.id)
          totalCleaned += cleaned
        } catch (error) {
          console.error(`[Review Cleanup] Error cleaning tenant ${tenant.id}:`, error)
          // Continue with other tenants even if one fails
        }
      }

      console.log(`[Review Cleanup] Periodic cleanup complete: ${totalCleaned} reviews reset`)
    } catch (error) {
      console.error('[Review Cleanup] Error in periodic cleanup job:', error)
    }
  }, intervalMs)

  return intervalId
}
