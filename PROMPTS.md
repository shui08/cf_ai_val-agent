"look through the whole repo and explain to me, using simple and easy to understand
language, how this ai agent works so i can start to build my own off this template"

"so my agent extends durable object? what is a durable object in simple terms?"

"if i added a new tool, would i need to also edit the prompt to tell the llm how to use that tool?"

"i want to build an ai valorant agent based off of this template. the agent will
retrieve the user's recent match history using the HenrikDev Valorant API and then
answer any performance or analytics questions based off of the retrieved info.
i want you to help me plan this all out."

"im thinking maybe i add a little section in the UI where a user can input a riot
tag and click a button that says "ingest." the app will then remember that we are
asking questions about that specific player, and it will store that match history
in memory somewhere. if we input a different player, the app will then switch focus
to the new player, delete the match entries in the database for the old player,
and write in the new match entries. is this feasible and possible to do?
i want you to think critically about these design decisions"

"im fine with switching an "active player" pointer, but here's the issue: what happens
when a player whose match history is already in the database starts playing new
matches? we will need to update the database. how would you implement this?"

"i also think i would like to scrap the idea of the ingest button. i want the
general flow of the program to look like this:

1. User types something in chat related to a riot tag ex:
   "How is ollie#chaos doing on ascent?", "my riot id is ollie#chaos",
   "ollie#chaos", "ingest recent matches for ollie#chaos",
   "what is ollie#chaos average KDR recently?", etc.

2. Once that riot id is mentioned, the agent remembers that specific riot id as
   the current player we are talking about in conversation. as such, any subsequent
   questions "how am I doing on ascent?", "what's MY current performance looking like?",
   etc. will refer to that current player UNTIL a new riot id is mentioned.

3. the agent will also use the necessary tools to make api calls to ingest match
   history for the current riot id, which will then be stored in the database.

SIDENOTE: if a new riot id is mentioned, then switch the current/active player to
that new riot id. Additionally, after a riot id is mentioned, things in the database
will update as well (current player pointers, new pointers, new match entries,
update match entries, and anything else necessary).

4. The agent will then answer the user's question. if a riot tag was provided with
   no question (ex: my riot tag is ollie#chaos), the agent will say something like
   "matches successfully ingested." if the user did provide a question with the riot
   tag ("how is ollie#chaos kdr on ascent recently?), then the agent will answer that question.

5. again, the agent will answer any subsequent questions about the current player
   ex: "how am I doing on ascent?", "what's MY current performance looking like?",
   etc. UNTIL a new riot id is mentioned.

ADDITIONAL NOTES:
here is an example request and response from the henrikdev valorant API:

...

is this all feasible? give me a detailed, step by step guide on fully implementing
all of this. think critically about any nuance i may have missed."

"lets start with the code. can you give me some starter code for everything
that you described in step 2 (tools etc)?"

"verify that everything i have written thus far is functional. are there
any potential missed edge cases/nuance"

"alright. could you implement "step 3) Update the system prompt so the model orchestrates correctly"?
try to make the prompt as thorough as possible."

"i typed "hello there" and got this error in the terminal. in the chat, i also received no response.  
i still want to be able to chat to the LLM normally if i dont mention anything
about my riot id/valorant. i also typed my riot id into the chat and received no response again."

"@https://docs.henrikdev.xyz/valorant/api-reference/matchlist
next issue: it doesnt seem like my agent is actually getting any performance
information from the matches it ingests. here are some sample chats and json
requests/responses:

...

"

"could you implement those changes? also, i definitely agree with adding a tiny
rule in the prompt so ingestion isnt skipped."

"can you walk me through the wrangler commands to deploy this with cloudflare"

pasted some chat logs for bug fixing related to match ingestion

"im looking at the raw JSON response for match history, and i think ive realized why
i cant get any performance info. the json responses are much longer than what the docs say.
just one match of valorant returns almost 43000 lines of JSON. i think it gives
data on every single round in the match. do you have a workaround for this? all that
information cannot be stored in the database"

"i like all of this, including the summarizerecentperformance tool. some concerns:

if you want to integrate the summarizerecentperformance tool, we should probably also edit the prompt
(and possibly some other files/code) so the agent knows when to use the tool, correct?

are you storing the map names for each new map too? how are you finding and filling
out the required fields for each new match, while having to look through that huge
blob of JSON (im assuming by looking for the next available unique match id)?"

"yes, apply these edits."

"my app has shared memory. what is the best way to fix this?"

"ive caught another issue with the app. each message (both the user messages and the agent messages)
should have timestamps of when they were sent. however, the timestamps are displaying
the current time at the present moment, not the time the messages were sent"
