import { readJson } from '../storage'

/**
 * Read one JSON file of the database (see readJson), logging the underlying error and throwing one that names the file.
 * @param path - A path inside the database, such as `users.json`.
 * @throws {Error} `Could not read <path>` when the file can't be read.
 */
export const retrieveFile = async (path) => {
  const recordInfo = await readJson(path)
    .catch(err => console.error(err))
  if (!recordInfo) {
    throw new Error(`Could not read ${path}`)
  }
  return recordInfo
}
