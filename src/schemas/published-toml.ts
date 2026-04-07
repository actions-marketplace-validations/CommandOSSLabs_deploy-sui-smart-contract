import { z } from 'zod/v4'

export const publishedEntrySchema = z
  .object({
    'chain-id': z.string(),
    'published-at': z.string(),
    'original-id': z.string(),
    version: z.union([z.number(), z.bigint(), z.string()]),
    'toolchain-version': z.string(),
    'build-config': z.record(z.string(), z.unknown()).optional(),
    'upgrade-capability': z.string(),
  })
  .catchall(z.unknown())

export const publishedTomlSchema = z
  .object({
    published: z.record(z.string(), publishedEntrySchema).optional(),
  })
  .catchall(z.unknown())
