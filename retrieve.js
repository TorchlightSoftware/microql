import jp from 'jsonpath'

/**
 * Retrieve value from source using JSONPath with optional post-processing
 * Custom extension: using flags after | character to do post-processing
 */
export default function retrieve(path, source) {
  // If it's not a path, just return the string
  if (!/^\$/.test(path)) return path

  const [query, opts = '1'] = path.split('|')

  try {
    let findings = jp.query(source, query)
    
    // Apply post-processing options
    for (const option of opts) {
      switch (option) {
        case 'a':
          // Keep as array
          break
        case 'f':
          // Flatten array
          findings = findings.flat()
          break
        case '1':
          // Take first element
          findings = findings[0]
          break
      }
    }
    
    return findings
  } catch (e) {
    return { error: e.message, reason: 'jsonpath', path }
  }
}