import { storagePath } from './storagePath'
import { nodeFiles } from './nodeFiles'
import { pendingListing } from './writeSet'

/**
 * The files in `folder` and the folders inside it, as paths relative to the database (`base` is the folder's own).
 * Walks one folder at a time with a plain readdir, so it needs no `recursive` option (which older Node versions
 * ignore without an error, listing only the top folder) and no `Dirent.parentPath`.
 * @param base - The folder's path inside the database, ending in `/` (empty for the database itself).
 */
const walk = async (base: string): Promise<string[]> => {
  let entries
  try {
    entries = await nodeFiles().readdir(storagePath(base), { withFileTypes: true })
  } catch (error) {
    if ((error as { code?: string })?.code === 'ENOENT') {
      return []
    }
    throw error
  }
  const paths: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      paths.push(...await walk(`${base}${entry.name}/`))
    } else if (entry.isFile()) {
      paths.push(`${base}${entry.name}`)
    }
  }
  return paths
}

/**
 * Every file in a folder of the database and the folders inside it, as paths inside the database (such as
 * `users/1.json`), sorted. During a statement it counts what the statement has written or deleted (see withWriteSet).
 * A folder that doesn't exist has no files. Node only.
 * @param path - A path inside the database, such as `users`. Empty for the whole database.
 */
export const listFiles = async (path: string = ''): Promise<string[]> => {
  const base = path ? `${path.replace(/\/+$/, '')}/` : ''
  const onDisk = (await walk(base)).map(file => storagePath(file))
  const root = storagePath()
  return pendingListing(storagePath(path), onDisk)
    .map(location => location.slice(root.length))
    .sort()
}
