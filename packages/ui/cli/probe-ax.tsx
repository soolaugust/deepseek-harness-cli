import * as React from 'react'
import { render, Text, useInput } from 'ink'
import { useState } from 'react'
function Probe() {
  const [v, setV] = useState('')
  useInput((i, k) => { if (k.return) setV(x => x + '[RET]'); else setV(x => x + i) })
  return <Text>V:{v || '(none)'}</Text>
}
const inst = render(<Probe />)
setTimeout(() => inst.unmount(), 10000)
