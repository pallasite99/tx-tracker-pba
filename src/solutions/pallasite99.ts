import type {
  API,
  FinalizedEvent,
  IncomingEvent,
  NewBlockEvent,
  NewTransactionEvent,
  OutputAPI,
} from "../types"

export default function pallasite99(api: API, outputApi: OutputAPI) {
  const txQueue: {
    hash: string
    seenInBlocks: Set<string>
    finalizedIn?: string
  }[] = []

  const seenBlocks: string[] = []

  const getTx = (hash: string) => {
    let tx = txQueue.find(t => t.hash === hash)
    if (!tx) {
      tx = { hash, seenInBlocks: new Set() }
      txQueue.push(tx)
    }
    return tx
  }

  const settleTxInBlock = (txHash: string, blockHash: string) => {
    const tx = getTx(txHash)
    if (tx.seenInBlocks.has(blockHash)) return

    try {
      const isValid = api.isTxValid(blockHash, txHash)
      const state = isValid
        ? {
            blockHash,
            type: "valid" as const,
            successful: api.isTxSuccessful(blockHash, txHash),
          }
        : {
            blockHash,
            type: "invalid" as const,
          }

      tx.seenInBlocks.add(blockHash)
      outputApi.onTxSettled(txHash, state)
    } catch {
      // tx not in this block
    }
  }

  const onNewTx = ({ value }: NewTransactionEvent) => {
    const tx = getTx(value)
    for (const blockHash of seenBlocks) {
      settleTxInBlock(tx.hash, blockHash)
    }
  }

  const onNewBlock = ({ blockHash }: NewBlockEvent) => {
    seenBlocks.push(blockHash)
    for (const tx of txQueue) {
      settleTxInBlock(tx.hash, blockHash)
    }
  }

  const onFinalized = ({ blockHash }: FinalizedEvent) => {
    for (const tx of txQueue) {
      if (tx.seenInBlocks.has(blockHash) && tx.finalizedIn !== blockHash) {
        tx.finalizedIn = blockHash

        try {
          const isValid = api.isTxValid(blockHash, tx.hash)
          const state = isValid
            ? {
                blockHash,
                type: "valid" as const,
                successful: api.isTxSuccessful(blockHash, tx.hash),
              }
            : {
                blockHash,
                type: "invalid" as const,
              }

          outputApi.onTxDone(tx.hash, state)
        } catch {
          // not finalizable
        }
      }
    }
  }

  return (event: IncomingEvent) => {
    switch (event.type) {
      case "newTransaction":
        onNewTx(event)
        break
      case "newBlock":
        onNewBlock(event)
        break
      case "finalized":
        onFinalized(event)
        break
    }
  }
}
