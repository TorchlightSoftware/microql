import jp from 'jsonpath'

// jsonpath docs:
// https://github.com/dchester/jsonpath
//
// Custom extension: using flags after | character to do post-processing
function retrieve(path, source) {
  // if it's not a path, just return the string
  if (!/^\$/.test(path)) return path

  let [query, opts] = path.split('|')
  opts || (opts = '1')

  var findings
  try {
    findings = jp.query(source, query)
    opts.split('').forEach((o) => {
      switch (o) {
        case 'a':
          break
        case 'f':
          findings = _.flatten(findings)
          break
        case '1':
          findings = findings[0]
          break
      }
    })
  } catch (e) {
    findings = { error: e.message, reason: 'alias', path }
  }
  return findings
}

export default retrieve
