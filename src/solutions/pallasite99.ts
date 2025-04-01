import type {
  API,
  FinalizedEvent,
  IncomingEvent,
  NewBlockEvent,
  NewTransactionEvent,
  OutputAPI,
} from "../types"

export default function pallasite99(api: API, outputApi: OutputAPI) {
  // Track each transaction with the blocks it's seen in and its finalized block (if any)
  const txQueue: {
    hash: string
    seenInBlocks: Set<string>
    finalizedIn?: string
  }[] = []

  // Maintain a list of all blocks seen so far, in order
  const seenBlocks: string[] = []

  // Retrieve a transaction from the queue by hash, or create and register it if not found
  const getTx = (hash: string) => {
    let tx = txQueue.find(t => t.hash === hash)
    if (!tx) {
      tx = { hash, seenInBlocks: new Set() }
      txQueue.push(tx)
    }
    return tx
  }

  // Attempt to settle a transaction in a given block if it hasn't been settled there yet
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
      // Transaction not found in this block, ignore
    }
  }

  // Handle new transaction by checking it against all previously seen blocks
  const onNewTx = ({ value }: NewTransactionEvent) => {
    const tx = getTx(value)
    for (const blockHash of seenBlocks) {
      settleTxInBlock(tx.hash, blockHash)
    }
  }

  // Handle a new block by attempting to settle all known transactions against it
  const onNewBlock = ({ blockHash }: NewBlockEvent) => {
    seenBlocks.push(blockHash)
    for (const tx of txQueue) {
      settleTxInBlock(tx.hash, blockHash)
    }
  }

  // Finalize transactions that were settled in the finalized block
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
          // Transaction cannot be finalized in this block, ignore
        }
      }
    }
  }

  // Dispatch to appropriate handler based on event type
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
