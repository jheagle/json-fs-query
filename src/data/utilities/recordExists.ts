import { fileExists } from '../storage'

/**
 * Whether a record (its `<name>.json` file) exists in the database. Node only, like the schema statements that use it.
 * @param entity
 */
export const recordExists = (entity: string): boolean => fileExists(`${entity}.json`)
