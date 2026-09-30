/** Minimal ABIs used by the dashboard (reads + playground). */

export const registryAbi = [
  {
    name: "getPolicies",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "appKey", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "allowlist", type: "address[]" },
          { name: "blocklist", type: "address[]" },
          { name: "perAddressCap", type: "uint256" },
          { name: "dailyBudget", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "paused", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "daySpent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "appKey", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setPolicy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "appKey", type: "bytes32" },
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "allowlist", type: "address[]" },
          { name: "blocklist", type: "address[]" },
          { name: "perAddressCap", type: "uint256" },
          { name: "dailyBudget", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "paused", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const vaultAbi = [
  {
    name: "budgetOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "appKey", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "depositNative",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "appKey", type: "bytes32" }],
    outputs: [],
  },
] as const;

export const paymasterAbi = [
  {
    name: "gm_sponsorable",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "appKey", type: "bytes32" },
      { name: "to", type: "address" },
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [
      { name: "sponsorable", type: "bool" },
      { name: "policyId", type: "bytes32" },
    ],
  },
  {
    name: "sponsorAndSend",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "appKey", type: "bytes32" },
      { name: "target", type: "address" },
      { name: "beneficiary", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "gasUsed", type: "uint256" },
      { name: "success", type: "bool" },
    ],
  },
] as const;

export const counterAbi = [
  {
    name: "increment",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "count",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
