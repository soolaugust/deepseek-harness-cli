import * as React from 'react'
import { render, Text, Box, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { useState } from 'react'

function Mini() {
  const [val, setVal] = useState('')
  const [keys, setKeys] = useState('')
  const [done, setDone] = useState('')
  useInput(input => setKeys(k => k + input))
  return (
    <Box flexDirection="column">
      <Text>KEYS: {keys || '(none)'}</Text>
      <Text>DONE: {done || '(none)'}</Text>
      <Text>VAL: {val || '(empty)'}</Text>
      <TextInput value={val} onChange={setVal} onSubmit={(v) => { setDone('SUBMITTED:' + v); setVal('') }} />
    </Box>
  )
}
const inst = render(<Mini />)
setTimeout(() => inst.unmount(), 15000)
