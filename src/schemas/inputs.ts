import { z } from 'zod/v4'

export const actionInputsSchema = z.object({
  dir: z.string().min(1),
  env: z.string().min(1),
  rpcUrl: z.url().optional(),
  deployMode: z.enum(['auto', 'force-publish', 'safe-upgrade-only']),
})
