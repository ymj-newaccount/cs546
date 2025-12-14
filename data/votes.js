//votes.js 
import {getDb} from '../config/mongoConnection.js';
import {getUserById} from './users.js';

const MAX_USER_ID = 200;
const MAX_REPORT_LEN = 200;
let voteIndex;


//Returns vote collection and sures it exists 
//Prevents duplicate votes

async function votesCollection()
{
    const db = await getDb();
    const col = db.collection('votes');

    if(!voteIndex)
    {
        voteIndex = (async () => 
        {
            //User gets one vote per report 
            await col.createIndex(
                { reportId : 1, userId :1},
                {unique: true}
            );

            //Look up
            await col.createIndex ({ reportId: 1, createdAt: -1});
        })();
    }
    await voteIndex;
    return col;
}

//Error checking helpers
function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string') throw makeError(`${name} must be a string`, 400);
  const s = v.trim();
  if (!s) throw makeError(`${name} cannot be empty`, 400);
  return s;
}

function normalizeVote(vote) {
  const v = Number(vote);
  if(v !== 1 && v !== -1)
  {
    throw makeError('vote must be +1 or -1', 400);
  }
  return v
}


//Create or update a vote on a report 
export async function castVote({reportId, userId, vote})
{
    let rID = assertNonEmptyString(reportId, "reportId");
    let uID = assertNonEmptyString(userId, "userId");
    let v = normalizeVote(vote);

    const votes = await votesCollection();
    const today = new Date();

    const user = await getUserById(uID);
    let weight = 1; 
    if(user && user.reputation !== null)
    {
        const w = Number(user.reputation);
        if(Number.isFinite(w) && w > 0) 
        {
            weight = w;
        }
    }
    await votes.updateOne( {reportId: rID, userId: uID}, 
        {
            $set: 
            {
                vote: v,
                weight : weight,
                updatedAt: today
            },
            $setOnInsert:
            {
                reportId : rID,
                userId: uID,
                createdAt: today
            }
        },
            {upsert: true}
        );
    return {reportId: rID, userId: uID, vote: v, weight: weight};

}

//Remove a vote
export async function removeVote(reportId, userId)
{
    let rID = assertNonEmptyString(reportId, "reportId");
    let uID = assertNonEmptyString(userId, "userId");

    const votes = await votesCollection();
    await votes.deleteOne({reportId: rID, userId: uID});

    return true;
}

//Get total votes for report
export async function getTotalVotes(reportId)
{
    let rID = assertNonEmptyString(reportId, "reportId");
    const votes = await votesCollection();

    const countedvotes = await votes.find({reportId: rID}, {projection: {vote: 1, weight: 1}}).toArray();

    let upVotes = 0;
    let downVotes = 0;

    let uWeight = 0;
    let dWeight = 0;

    for(let i = 0; i < countedvotes.length; i++)
    {
        const v = Number(countedvotes[i].vote);
        const wR = countedvotes[i].weight;
        const w = Number(wR);
        if(!Number.isFinite(w))
        {
            continue;
        }
        if(v === 1)
        {
            
            upVotes++;
            uWeight += w;
            
        }
        else if(v === -1)
        {
           
            downVotes++;
            dWeight += w;
        }
    }
    return {upVotes, downVotes, score: upVotes - downVotes, uWeight, dWeight, weightedScore: uWeight-dWeight, voteCount: upVotes +downVotes};


}

//get current user's votes for report
export async function getUserVoteForReport(reportId, userId)
{
    let rID = assertNonEmptyString(reportId, "reportId");
    let uID = assertNonEmptyString(userId, "userId");

    const votes = await votesCollection();
    const uVote = await votes.findOne( {reportId: rID, userId: uID}, {projection: {vote: 1}});
   
    if(!uVote)
    {
        return 0;
    }
    const v = Number(uVote.vote);
    let result;
    if(v === 1)
    {
        result = 1;
    }
    else if(v === -1)
    {
        result = -1;
    }
    else
    {
        result = 0;
    }
    return result;
}

