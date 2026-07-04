#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Owner,
    Goal,
    TotalRaised,
    Token,
    BadgeContract,
    DonorAmount(Address),
}

#[contract]
pub struct CrowdfundingContract;

#[contractimpl]
impl CrowdfundingContract {
    pub fn initialize(
        env: Env,
        campaign_owner: Address,
        goal_amount: i128,
        token: Address,
        badge_contract: Address,
    ) {
        if env.storage().instance().has(&DataKey::Owner) {
            panic!("Already initialized");
        }
        env.storage().instance().set(&DataKey::Owner, &campaign_owner);
        env.storage().instance().set(&DataKey::Goal, &goal_amount);
        env.storage().instance().set(&DataKey::TotalRaised, &0i128);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::BadgeContract, &badge_contract);
    }

    pub fn donate(env: Env, donor: Address, amount: i128) {
        if amount <= 0 {
            panic!("Amount must be greater than zero");
        }
        donor.require_auth();

        let token_address: Address = env.storage().instance().get(&DataKey::Token).expect("Not initialized");
        let campaign_owner: Address = env.storage().instance().get(&DataKey::Owner).expect("Not initialized");

        // Transfer tokens from donor to campaign_owner (immediate disbursement)
        let token_client = soroban_sdk::token::Client::new(&env, &token_address);
        token_client.transfer(&donor, &campaign_owner, &amount);

        // Update total raised
        let mut total = env.storage().instance().get(&DataKey::TotalRaised).unwrap_or(0i128);
        total += amount;
        env.storage().instance().set(&DataKey::TotalRaised, &total);

        // Update donor's cumulative total
        let mut donor_total = env.storage().persistent().get(&DataKey::DonorAmount(donor.clone())).unwrap_or(0i128);
        donor_total += amount;
        env.storage().persistent().set(&DataKey::DonorAmount(donor.clone()), &donor_total);

        // Check badge threshold (XLM 7 decimals)
        let decimals = 10_000_000i128;
        let bronze_threshold = 50 * decimals;
        let silver_threshold = 200 * decimals;
        let gold_threshold = 500 * decimals;

        let mut tier = 0;
        if donor_total >= gold_threshold {
            tier = 3; // Gold
        } else if donor_total >= silver_threshold {
            tier = 2; // Silver
        } else if donor_total >= bronze_threshold {
            tier = 1; // Bronze
        }

        if tier > 0 {
            let badge_contract: Address = env.storage().instance().get(&DataKey::BadgeContract).expect("Badge contract not set");
            
            // Check current tier on the badge contract
            use soroban_sdk::IntoVal;
            let current_tier: u32 = env.invoke_contract(
                &badge_contract,
                &Symbol::new(&env, "get_badge_tier"),
                soroban_sdk::vec![&env, donor.clone().into_val(&env)]
            );

            if tier > current_tier {
                // Mint/Upgrade badge
                let _: () = env.invoke_contract(
                    &badge_contract,
                    &Symbol::new(&env, "mint_badge"),
                    soroban_sdk::vec![&env, donor.clone().into_val(&env), tier.into_val(&env)]
                );
            }
        }

        // Emit donation_received event (donor, amount, new_total)
        env.events().publish(
            (Symbol::new(&env, "donation_received"), donor),
            (amount, total)
        );
    }

    pub fn get_total_raised(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalRaised).unwrap_or(0i128)
    }

    pub fn get_goal(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Goal).unwrap_or(0i128)
    }
}

#[cfg(test)]
mod test;
