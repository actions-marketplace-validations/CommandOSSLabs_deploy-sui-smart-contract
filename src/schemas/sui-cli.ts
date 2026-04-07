import { z } from 'zod/v4'

export const suiEnvConfigSchema = z
  .object({
    alias: z.string(),
    rpc: z.string(),
  })
  .catchall(z.unknown())

export const suiEnvTupleSchema = z.tuple([
  z.array(suiEnvConfigSchema),
  z.string().optional(),
])

export const suiEnvObjectSchema = z.object({
  envs: z.array(suiEnvConfigSchema).optional(),
  activeEnv: z.string().optional(),
})

export const gasCoinSchema = z
  .object({
    mistBalance: z.union([z.number(), z.string()]),
  })
  .catchall(z.unknown())

export const gasCoinArraySchema = z.array(gasCoinSchema)

export const txResponseSchema = z
  .object({
    digest: z.string(),
    effects: z.object({
      status: z.object({
        status: z.enum(['success', 'failure']),
        error: z.string().optional(),
      }),
    }),
    objectChanges: z.array(
      z.object({ type: z.string() }).catchall(z.unknown())
    ),
  })
  .catchall(z.unknown())
