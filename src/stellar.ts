import {
  rpc,
  Horizon,
  Networks,
  TransactionBuilder,
  Operation,
  Contract,
  nativeToScVal,
  scValToNative,
  Account
} from "@stellar/stellar-sdk";

export const CROWDFUNDING_CONTRACT_ID = "CDQ2DV6I7HIZYOALI4RZ42MTWKAFUODQWP4BH2GHMKP37Z5P7PB4OLTX";
export const REWARDS_BADGE_CONTRACT_ID = "CAAP5TGGZGLFXYGJY2H2O637FREG4EXE2PXI3A3Y4D6ST74QMI4YBD6C";
export const XLM_NATIVE_CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const RPC_URL = "https://soroban-testnet.stellar.org";

const horizonServer = new Horizon.Server(HORIZON_URL);
const rpcServer = new rpc.Server(RPC_URL);

/**
 * Fetch the XLM balance of a given account from Horizon.
 */
export async function getXlmBalance(publicKey: string): Promise<string> {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    const nativeBalance = account.balances.find((b) => b.asset_type === "native");
    return nativeBalance ? nativeBalance.balance : "0";
  } catch (error) {
    console.error("Error fetching balance:", error);
    return "0";
  }
}

/**
 * Fetch the campaign goal from the contract (returned in XLM).
 */
export async function getCampaignGoal(): Promise<number> {
  try {
    const contract = new Contract(CROWDFUNDING_CONTRACT_ID);
    const response = await rpcServer.simulateTransaction(
      new TransactionBuilder(
        new Account("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "0"),
        { fee: "100", networkPassphrase: Networks.TESTNET }
      )
        .addOperation(contract.call("get_goal"))
        .setTimeout(30)
        .build()
    );

    if (rpc.Api.isSimulationSuccess(response)) {
      const resultVal = response.result?.retval;
      if (resultVal) {
        const rawGoal = scValToNative(resultVal);
        return Number(rawGoal) / 10_000_000;
      }
    }
    return 0;
  } catch (error) {
    console.error("Error fetching campaign goal:", error);
    return 0;
  }
}

/**
 * Fetch the total raised amount from the contract (returned in XLM).
 */
export async function getCampaignTotalRaised(): Promise<number> {
  try {
    const contract = new Contract(CROWDFUNDING_CONTRACT_ID);
    const response = await rpcServer.simulateTransaction(
      new TransactionBuilder(
        new Account("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "0"),
        { fee: "100", networkPassphrase: Networks.TESTNET }
      )
        .addOperation(contract.call("get_total_raised"))
        .setTimeout(30)
        .build()
    );

    if (rpc.Api.isSimulationSuccess(response)) {
      const resultVal = response.result?.retval;
      if (resultVal) {
        const rawRaised = scValToNative(resultVal);
        return Number(rawRaised) / 10_000_000;
      }
    }
    return 0;
  } catch (error) {
    console.error("Error fetching total raised:", error);
    return 0;
  }
}

/**
 * Fetch the badge tier of the user (0 = None, 1 = Bronze, 2 = Silver, 3 = Gold).
 */
export async function getUserBadgeTier(publicKey: string): Promise<number> {
  try {
    const contract = new Contract(REWARDS_BADGE_CONTRACT_ID);
    const response = await rpcServer.simulateTransaction(
      new TransactionBuilder(
        new Account("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "0"),
        { fee: "100", networkPassphrase: Networks.TESTNET }
      )
        .addOperation(
          contract.call(
            "get_badge_tier",
            nativeToScVal(publicKey, { type: "address" })
          )
        )
        .setTimeout(30)
        .build()
    );

    if (rpc.Api.isSimulationSuccess(response)) {
      const resultVal = response.result?.retval;
      if (resultVal) {
        return Number(scValToNative(resultVal));
      }
    }
    return 0;
  } catch (error) {
    console.error("Error fetching user badge tier:", error);
    return 0;
  }
}

/**
 * Build, simulate, and prepare a donation transaction.
 * Returns the base64 transaction XDR to be signed by the wallet.
 */
export async function prepareDonateTransaction(
  donorPublicKey: string,
  amountXlm: number
): Promise<string> {
  const account = await horizonServer.loadAccount(donorPublicKey);
  const amountStroops = Math.floor(amountXlm * 10_000_000);

  const tx = new TransactionBuilder(account, {
    fee: "100000", // Will be optimized during prepareTransaction
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CROWDFUNDING_CONTRACT_ID,
        function: "donate",
        args: [
          nativeToScVal(donorPublicKey, { type: "address" }),
          nativeToScVal(amountStroops, { type: "i128" }),
        ],
      })
    )
    .setTimeout(60)
    .build();

  // Prepare transaction (simulates, calculates resource footprint and fees)
  const preparedTx = await rpcServer.prepareTransaction(tx);
  return preparedTx.toEnvelope().toXDR("base64");
}

/**
 * Submit signed transaction XDR and poll for result.
 */
export async function submitAndPollTransaction(signedTxXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
  const response = await rpcServer.sendTransaction(tx);

  if (response.status === "ERROR") {
    throw new Error(`Transaction submission failed: ${JSON.stringify(response.errorResult)}`);
  }

  // Poll for status
  let attempts = 0;
  while (attempts < 12) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const txStatus = await rpcServer.getTransaction(response.hash);
    if (txStatus.status === "SUCCESS") {
      return response.hash;
    } else if (txStatus.status === "FAILED") {
      throw new Error(`Transaction failed on chain: ${JSON.stringify(txStatus.resultXdr)}`);
    }
    attempts++;
  }

  throw new Error("Transaction polling timed out");
}

/**
 * Fetch recent contract events to build the live feed.
 */
export interface CampaignEvent {
  id: string;
  type: "donation" | "badge_mint";
  actor: string;
  amount?: number;
  tier?: string;
  ledger: number;
}

export async function getCampaignEvents(): Promise<CampaignEvent[]> {
  try {
    const startLedger = (await horizonServer.ledgers().order("desc").limit(1).call()).records[0].sequence - 10000;
    const response = await rpcServer.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [CROWDFUNDING_CONTRACT_ID, REWARDS_BADGE_CONTRACT_ID],
        },
      ],
      limit: 50,
    });

    const events: CampaignEvent[] = [];

    for (const record of response.events) {
      try {
        const topics = record.topic;
        const topic0 = scValToNative(topics[0]);

        if (topic0 === "donation_received") {
          const donorVal = scValToNative(topics[1]);
          const val = scValToNative(record.value);
          const amountVal = Array.isArray(val) ? Number(val[0]) / 10_000_000 : Number(val) / 10_000_000;
          events.push({
            id: record.id,
            type: "donation",
            actor: donorVal,
            amount: amountVal,
            ledger: record.ledger,
          });
        } else if (topic0 === "badge_minted") {
          const donorVal = scValToNative(topics[1]);
          const tierNum = Number(scValToNative(record.value));
          const tiers = ["None", "Bronze", "Silver", "Gold"];
          events.push({
            id: record.id,
            type: "badge_mint",
            actor: donorVal,
            tier: tiers[tierNum] || "Bronze",
            ledger: record.ledger,
          });
        }
      } catch (err) {
        console.error("Error parsing event record:", err);
      }
    }

    // Sort newest first
    return events.reverse();
  } catch (error) {
    console.error("Error fetching campaign events:", error);
    return [];
  }
}
