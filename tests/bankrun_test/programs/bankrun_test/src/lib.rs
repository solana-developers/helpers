use anchor_lang::prelude::*;

declare_id!("GhcmnSh5q2ZSpBCD6bkNKLXarKghCGg6QDVjk4wQbiav");

#[program]
pub mod bankrun_test {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
