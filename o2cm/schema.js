/**
 *  Created - 5/11/2017
 *  @author Paul Daniels
 */

const {buildSchema} = require('graphql');
const neo4j = require('neo4j');
const db = new neo4j.GraphDatabase('http://neo4j:admin@localhost:7474');
const Rx = require('rxjs');

const schema = buildSchema(`
  type Person {
    name: String
  }
  
  type Couple {
    lead: Person,
    follow: Person,
    number: Int
  }
  
  type Mark {
    value: Int!,
    judge: Person!,
    couple: Couple!
  }
  
  type Round {
    couples: [Couple],
    judges: [Person],
    marks: [Mark],
    name: String!,
    id: String!
  }
  
  type Event {
    rounds: [Round],
    name: String!
  }
  
  type Competition {
    id: String!,
    name: String!,
    events: [Event]
  }
  
  type Query {
    competition(compId: String): Competition
  }
`);

const cypher$ = Rx.Observable.bindNodeCallback(db.cypher.bind(db));
const identity = r => r;

const competitionByIdQuery = (id) => ({
  query: `
    MATCH (c: Competition {id: {id}})
    RETURN c
  `,
  params: {
    id
  }
});

const eventsByCompQuery = (id) => ({
  query: `
    MATCH (e: Event)-[:IN]->(:Competition {id: {id}})
    RETURN e
  `,
  params: {
    id
  }
});

const roundsByEventQuery = (id) => ({
  query: `
    MATCH (r: Round)-[:IN]->(:Event {id: {id}})
    RETURN r
  `,
  params: {
    id
  }
});

const judgesByRoundQuery = (eventId, roundId) => ({
  query: `
    MATCH (j:Person)-[:PARTICIPATED {role: {role}}]->(:Round {id: {roundId}})-[:IN]->(:Event {id:{eventId}})
    RETURN j
  `,
  params: {
    eventId,
    roundId,
    role: 'judge'
  }
});

const personQuery = (identifier, value) => ({
  query: `
    MATCH (person:Person {name: {value}})
    RETURN person
  `,
  params: {
    value
  }
});

const coupleQuery = (event, round) => ({
  query: `
    MATCH (c:Couple)-[:PARTICIPATED {role: {role}}]->(:Round {id: {round}})-[:IN]->(e:Event {id:{event}})
    MATCH (lead)-[:MEMBER_OF {role: 'lead'}]->(c)<-[:MEMBER_OF {role: 'follow'}]-(follow)
    RETURN lead, follow, c.number
  `,
  params: {
    role: 'competitor',
    event,
    round
  }
});

const root = {
  competition({compId}) {
    return cypher$(competitionByIdQuery(compId))
      .flatMap(identity, (_, resp) => new Competition(resp.c.properties))
      .take(1)
      .toPromise();
  }
};

// Models
class Competition {
  constructor({name, id}) {
    this.name = name;
    this.id = id;
  }

  events() {
    return cypher$(eventsByCompQuery(this.id))
      .flatMap(identity, (_, resp) => new Event(resp.e.properties))
      .toArray()
      .toPromise();
  }
}

class Event {
  constructor({name, id}) {
    this.name = name;
    this.id = id;
  }

  rounds() {
    return cypher$(roundsByEventQuery(this.id))
      .flatMap(identity, (_, resp) => new Round(this.id, resp.r.properties))
      .toArray()
      .toPromise();
  }
}

class Round {
  constructor(eventId, {name, id}) {
    this.eventId = eventId;
    this.id = id;
    this.name = name;
  }

  couples() {
    return cypher$(coupleQuery(this.eventId, this.id))
      .flatMap(identity, (_, resp) => new Couple(
        resp.lead.properties,
        resp.follow.properties,
        resp['c.number']
      ))
      .toArray()
      .toPromise();
  }

  judges() {
    return cypher$(judgesByRoundQuery(this.eventId, this.id))
      .flatMap(identity, (_, resp) => new Person(resp.j.properties))
      .toArray()
      .toPromise();
  }
}


class Couple {
  constructor(lead, follow, number) {
    this.lead = lead;
    this.follow = follow;
    this.number = number;
  }
}

class Person {
  constructor({name}) {
    this.name = name;
  }
}

module.exports = {
  root,
  schema
};