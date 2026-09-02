// Generated from the compiled artifacts and the Sepolia deployment record.
// Regenerate with: npm run gen:abi

export const sepolia = {
  pool: "0xaD044339Fd6235561aCC6cDc5727ab64eE26F304" as const,
  exitQueue: "0x4d0fBa42FFa6aD710D751f50a3941893A362969B" as const,
  asset: "0x4E7B06D78965594eB5EF5414c357ca21E1554491" as const,
  underlying: "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0" as const,
};

export const poolAbi = [
  {
    "inputs": [
      {
        "internalType": "contract IERC7984ERC20Wrapper",
        "name": "asset_",
        "type": "address"
      },
      {
        "internalType": "uint32",
        "name": "minParticipants_",
        "type": "uint32"
      },
      {
        "internalType": "uint32",
        "name": "maxScanBatch_",
        "type": "uint32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AmountNotOwnedBySender",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DrawInProgress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidConfiguration",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoDrawInProgress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoPrize",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotTheAsset",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "handle",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "SenderNotAllowedToUseHandle",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "have",
        "type": "uint32"
      },
      {
        "internalType": "uint32",
        "name": "need",
        "type": "uint32"
      }
    ],
    "name": "TooFewParticipants",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZamaProtocolUnsupported",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "Deposited",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "drawId",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "scanned",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "participantCount",
        "type": "uint32"
      }
    ],
    "name": "DrawAdvanced",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "drawId",
        "type": "uint64"
      }
    ],
    "name": "DrawSettled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "drawId",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "prize",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "participantCount",
        "type": "uint32"
      }
    ],
    "name": "DrawStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "sponsor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "amount",
        "type": "uint64"
      }
    ],
    "name": "PrizeSponsored",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "Withdrawn",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "batchSize",
        "type": "uint32"
      }
    ],
    "name": "advanceDraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "asset",
    "outputs": [
      {
        "internalType": "contract IERC7984ERC20Wrapper",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "confidentialBalanceOf",
    "outputs": [
      {
        "internalType": "euint64",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "confidentialProtocolId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "confidentialTwabOf",
    "outputs": [
      {
        "internalType": "euint128",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentDrawId",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "drawInProgress",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "drawId",
        "type": "uint64"
      }
    ],
    "name": "drawInfo",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint64",
            "name": "at",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "prize",
            "type": "uint64"
          },
          {
            "internalType": "uint32",
            "name": "participantCount",
            "type": "uint32"
          },
          {
            "internalType": "uint32",
            "name": "scanned",
            "type": "uint32"
          },
          {
            "internalType": "enum HushPool.DrawState",
            "name": "state",
            "type": "uint8"
          }
        ],
        "internalType": "struct HushPool.Draw",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "isParticipant",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxScanBatch",
    "outputs": [
      {
        "internalType": "uint32",
        "name": "",
        "type": "uint32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minParticipants",
    "outputs": [
      {
        "internalType": "uint32",
        "name": "",
        "type": "uint32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "euint64",
        "name": "amount",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "",
        "type": "bytes"
      }
    ],
    "name": "onConfidentialTransferReceived",
    "outputs": [
      {
        "internalType": "ebool",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "participantAt",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "participantCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "prizePot",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "amount",
        "type": "uint64"
      }
    ],
    "name": "sponsorPrize",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "startDraw",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "drawId",
        "type": "uint64"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "underlying",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "externalEuint64",
        "name": "encryptedAmount",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "inputProof",
        "type": "bytes"
      }
    ],
    "name": "withdraw",
    "outputs": [
      {
        "internalType": "euint64",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "euint64",
        "name": "amount",
        "type": "bytes32"
      }
    ],
    "name": "withdraw",
    "outputs": [
      {
        "internalType": "euint64",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export const exitQueueAbi = [
  {
    "inputs": [
      {
        "internalType": "contract IERC7984ERC20Wrapper",
        "name": "wrapper_",
        "type": "address"
      },
      {
        "internalType": "uint32",
        "name": "minParticipants_",
        "type": "uint32"
      },
      {
        "internalType": "uint64",
        "name": "minBatchAge_",
        "type": "uint64"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AlreadyClaimed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BatchNotOpen",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BatchNotPayable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BatchNotUnwrapping",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint32",
        "name": "have",
        "type": "uint32"
      },
      {
        "internalType": "uint32",
        "name": "need",
        "type": "uint32"
      }
    ],
    "name": "BatchTooSmall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "age",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "need",
        "type": "uint64"
      }
    ],
    "name": "BatchTooYoung",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidConfiguration",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidKMSSignatures",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotTheWrapper",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NothingToClaim",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZamaProtocolUnsupported",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "total",
        "type": "uint64"
      }
    ],
    "name": "BatchPayable",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "participants",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "unwrapRequestId",
        "type": "bytes32"
      }
    ],
    "name": "BatchSettling",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "ClaimOpened",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "amount",
        "type": "uint64"
      }
    ],
    "name": "Claimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "ExitRequested",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "bytes32[]",
        "name": "handlesList",
        "type": "bytes32[]"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "abiEncodedCleartexts",
        "type": "bytes"
      }
    ],
    "name": "PublicDecryptionVerified",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      }
    ],
    "name": "batchInfo",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint64",
            "name": "openedAt",
            "type": "uint64"
          },
          {
            "internalType": "uint32",
            "name": "participants",
            "type": "uint32"
          },
          {
            "internalType": "enum ExitQueue.BatchState",
            "name": "state",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "unwrapRequestId",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "total",
            "type": "uint64"
          }
        ],
        "internalType": "struct ExitQueue.Batch",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      }
    ],
    "name": "batchParticipants",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "clearAmount",
        "type": "uint64"
      },
      {
        "internalType": "bytes",
        "name": "decryptionProof",
        "type": "bytes"
      }
    ],
    "name": "claim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "confidentialProtocolId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "confidentialShareOf",
    "outputs": [
      {
        "internalType": "euint64",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentBatchId",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "clearTotal",
        "type": "uint64"
      },
      {
        "internalType": "bytes",
        "name": "decryptionProof",
        "type": "bytes"
      }
    ],
    "name": "finalizeBatch",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "hasClaimed",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minBatchAge",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minParticipants",
    "outputs": [
      {
        "internalType": "uint32",
        "name": "",
        "type": "uint32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "euint64",
        "name": "amount",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "",
        "type": "bytes"
      }
    ],
    "name": "onConfidentialTransferReceived",
    "outputs": [
      {
        "internalType": "ebool",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      }
    ],
    "name": "openClaim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "settleBatch",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "batchId",
        "type": "uint64"
      },
      {
        "internalType": "bytes32",
        "name": "unwrapRequestId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "settleable",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "underlying",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "wrapper",
    "outputs": [
      {
        "internalType": "contract IERC7984ERC20Wrapper",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const erc20Abi = [
  {
    "type": "function",
    "name": "mint",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "to",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": []
  },
  {
    "type": "function",
    "name": "approve",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "spender",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "type": "bool"
      }
    ]
  },
  {
    "type": "function",
    "name": "allowance",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "owner",
        "type": "address"
      },
      {
        "name": "spender",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "balanceOf",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "decimals",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint8"
      }
    ]
  }
] as const;

export const wrapperAbi = [
  {
    "type": "function",
    "name": "wrap",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "to",
        "type": "address"
      },
      {
        "name": "amount",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "type": "bytes32"
      }
    ]
  },
  {
    "type": "function",
    "name": "underlying",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "address"
      }
    ]
  },
  {
    "type": "function",
    "name": "rate",
    "stateMutability": "view",
    "inputs": [],
    "outputs": [
      {
        "type": "uint256"
      }
    ]
  },
  {
    "type": "function",
    "name": "confidentialBalanceOf",
    "stateMutability": "view",
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "type": "bytes32"
      }
    ]
  },
  {
    "type": "function",
    "name": "confidentialTransferAndCall",
    "stateMutability": "nonpayable",
    "inputs": [
      {
        "name": "to",
        "type": "address"
      },
      {
        "name": "encryptedAmount",
        "type": "bytes32"
      },
      {
        "name": "inputProof",
        "type": "bytes"
      },
      {
        "name": "data",
        "type": "bytes"
      }
    ],
    "outputs": [
      {
        "type": "bytes32"
      }
    ]
  }
] as const;
