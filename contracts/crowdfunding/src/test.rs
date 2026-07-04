#![cfg(test)]
use super::*;
use soroban_sdk::{Env, Address, Symbol, token, IntoVal};
use soroban_sdk::testutils::Address as _;
use rewards_badge::RewardsBadgeContract;

#[test]
fn test_crowdfunding_flow() {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Register Token Contract
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract(token_admin);
    let token_client = token::Client::new(&env, &token_contract_id);
    let token_admin_client = token::StellarAssetClient::new(&env, &token_contract_id);

    // 2. Register Rewards Badge Contract
    let badge_contract_id = env.register_contract(None, RewardsBadgeContract);

    // 3. Register Crowdfunding Contract
    let crowdfunding_contract_id = env.register_contract(None, CrowdfundingContract);
    let crowdfunding_client = CrowdfundingContractClient::new(&env, &crowdfunding_contract_id);

    // 4. Initialize Rewards Badge
    let _: () = env.invoke_contract(
        &badge_contract_id,
        &Symbol::new(&env, "initialize"),
        soroban_sdk::vec![&env, crowdfunding_contract_id.clone().into_val(&env)]
    );

    // 5. Initialize Crowdfunding Contract
    let campaign_owner = Address::generate(&env);
    let goal_amount = 1000 * 10_000_000i128; // 1000 XLM
    crowdfunding_client.initialize(&campaign_owner, &goal_amount, &token_contract_id, &badge_contract_id);

    // Verify initial values
    assert_eq!(crowdfunding_client.get_goal(), goal_amount);
    assert_eq!(crowdfunding_client.get_total_raised(), 0);

    // 6. Setup Donor and mint test tokens
    let donor = Address::generate(&env);
    token_admin_client.mint(&donor, &(1000 * 10_000_000i128));

    // Test case: Donate under threshold (10 XLM)
    let donate_amount_1 = 10 * 10_000_000i128;
    crowdfunding_client.donate(&donor, &donate_amount_1);

    // Verify raised amounts and token transfers
    assert_eq!(crowdfunding_client.get_total_raised(), donate_amount_1);
    assert_eq!(token_client.balance(&campaign_owner), donate_amount_1);
    assert_eq!(token_client.balance(&donor), (1000 * 10_000_000i128) - donate_amount_1);

    // Verify badge tier (should be 0)
    let badge_tier: u32 = env.invoke_contract(
        &badge_contract_id,
        &Symbol::new(&env, "get_badge_tier"),
        soroban_sdk::vec![&env, donor.clone().into_val(&env)]
    );
    assert_eq!(badge_tier, 0);

    // Test case: Cross Bronze threshold (total 60 XLM, need >= 50 XLM)
    let donate_amount_2 = 50 * 10_000_000i128;
    crowdfunding_client.donate(&donor, &donate_amount_2);

    assert_eq!(crowdfunding_client.get_total_raised(), donate_amount_1 + donate_amount_2);

    let badge_tier2: u32 = env.invoke_contract(
        &badge_contract_id,
        &Symbol::new(&env, "get_badge_tier"),
        soroban_sdk::vec![&env, donor.clone().into_val(&env)]
    );
    assert_eq!(badge_tier2, 1); // Bronze badge

    // Test case: Cross Silver threshold (total 210 XLM, need >= 200 XLM)
    let donate_amount_3 = 150 * 10_000_000i128;
    crowdfunding_client.donate(&donor, &donate_amount_3);

    let badge_tier3: u32 = env.invoke_contract(
        &badge_contract_id,
        &Symbol::new(&env, "get_badge_tier"),
        soroban_sdk::vec![&env, donor.clone().into_val(&env)]
    );
    assert_eq!(badge_tier3, 2); // Silver badge

    // Test case: Cross Gold threshold (total 510 XLM, need >= 500 XLM)
    let donate_amount_4 = 300 * 10_000_000i128;
    crowdfunding_client.donate(&donor, &donate_amount_4);

    let badge_tier4: u32 = env.invoke_contract(
        &badge_contract_id,
        &Symbol::new(&env, "get_badge_tier"),
        soroban_sdk::vec![&env, donor.clone().into_val(&env)]
    );
    assert_eq!(badge_tier4, 3); // Gold badge
}
