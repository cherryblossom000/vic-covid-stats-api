import { ApolloServer } from '@saeris/apollo-server-vercel';
import { GraphQLInterfaceType, GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import graphqlFields from 'graphql-fields';
import { GraphQLDate, GraphQLDateTime } from 'graphql-scalars';
import qs from 'qs';
import { request } from 'undici';
const homePageMainStats = [
    'newCases',
    'newPCRTests',
    'newRATCases',
    'hospitalCases',
    'icuCases',
    'newDeaths'
];
const homePageVaxStats = ['dose1', 'dose2', 'dose3'];
const dataPageStats = [
    'newPCRCases',
    'activeCases',
    'totalPCRTests',
    'totalPCRCases',
    'totalDeaths',
    'totalRecovered'
];
// #endregion
// #region Constants
const COVID_SITE = 'https://www.coronavirus.vic.gov.au';
const MONTHS = {
    /* eslint-disable @typescript-eslint/naming-convention -- months */
    January: '01',
    February: '02',
    March: '03',
    April: '04',
    May: '05',
    June: '06',
    July: '07',
    August: '08',
    September: '09',
    October: '10',
    November: '11',
    December: '12'
    /* eslint-enable @typescript-eslint/naming-convention */
};
const NAME_TO_IDS = {
    dose1: 'd675c960-cb31-4d94-8b18-dd31b6454aff',
    dose2: '4d5012f2-b692-459b-b07f-c91617fcb0d9',
    dose3: '11fe8010-615b-480b-8af3-8810c914c6f7',
    newCases: 'bdbed36c-9a83-4ca5-9e93-2052dcba74d3',
    newPCRTests: '8454415a-c079-4edb-942d-aae49f9243eb',
    newRATCases: '08ef30d1-0df5-4709-9f13-c29e2e9e06a1',
    hospitalCases: 'e686ad47-2c6f-4b4a-b4da-7403de0d4f62',
    icuCases: '9465725a-4321-471c-928c-76be4577ac86',
    newDeaths: 'e9a50592-264e-42d7-adb5-27716cb16d41',
    newPCRCases: '8e545be4-b7ab-4f9b-a04e-eb0ba4c815b8',
    activeCases: '4e3ebe45-e6b6-42c4-8460-cbfe292d2acd',
    totalPCRTests: 'f862f783-74a1-4479-b096-ae9167e58525',
    totalPCRCases: 'b725902f-6878-4829-b9eb-35d605a1be34',
    totalDeaths: '69a44e8d-e04b-4c9a-ad7e-4dda9c662ad2',
    totalRecovered: '9c9481a7-d67b-4815-9a2d-bb6d71c1a774'
};
const HOME_PAGE_MAIN_UPDATED_ID = 'bc10ccc5-f19e-4cc5-832d-fdfe86639106';
const HOME_PAGE_VAX_UPDATED_ID = '27c3f771-fdee-4fe9-a014-88c611b81de0';
const DATA_PAGE_UPDATED_ID = '748ad06f-7143-47f1-8006-1347e9d4dd10';
const IDS_TO_NAME = Object.fromEntries(Object.entries(NAME_TO_IDS).map(([name, id]) => [id, name]));
const HOME_PAGE_UPDATED_RE = /Data last updated .+?day (\d\d?) (\w+?) (\d{4})(?:\.|<\/p>)/u;
const DATA_PAGE_UPDATED_RE = /Updated: (\d\d?) (\w+?) (\d{4}) (\d\d?):(\d\d?) (a|p)m<\/h2>/u;
const parseHomePageDate = (text) => {
    const [, day, month, year] = HOME_PAGE_UPDATED_RE.exec(text);
    return `${year}-${MONTHS[month]}-${day}`;
};
// #endregion
// #region Utils
const fetch = async (url, accept, message) => {
    const { statusCode, body } = await request(url, accept === undefined ? undefined : { headers: { accept } });
    if (statusCode !== 200) {
        throw new Error(`HTTP status code ${statusCode}${message === undefined ? '' : ` ${message}`}`);
    }
    return body;
};
const fetchJSON = async (...args) => (await fetch(...args)).json();
const covidAPI = async (path, message, query) => {
    const response = await fetchJSON(`https://content.vic.gov.au/api/v1/${path}${query ? `?${qs.stringify(query)}` : ''}`, 'application/vnd.api+json', `fetching ${message}`);
    if ('errors' in response) {
        throw new Error(`fetching ${message} failed: ${JSON.stringify(response.errors, null, 2)}`);
    }
    return response.data;
};
const fetchParagraph = async (id, message) => (await covidAPI(`paragraph/basic_text/${id}`, `${message} updated`)).attributes.field_paragraph_body.value;
// #endregion
// #region GraphQL Utils
const nonNullString = {
    type: new GraphQLNonNull(GraphQLString)
};
const makeUpdatedFields = (type) => ({
    updated: { type: new GraphQLNonNull(type) }
});
const dateUpdatedFields = makeUpdatedFields(GraphQLDate);
const dateUpdatedInterface = new GraphQLInterfaceType({
    name: 'DateUpdated',
    fields: dateUpdatedFields
});
const statsField = (name, description, statKeys, extra) => ({
    description,
    type: new GraphQLNonNull(new GraphQLObjectType({
        ...extra,
        name,
        fields: {
            ...extra?.fields,
            ...Object.fromEntries(statKeys.map(s => [s, nonNullString]))
        }
    }))
});
// #endregion
export default new ApolloServer({
    introspection: true,
    playground: true,
    schema: new GraphQLSchema({
        query: new GraphQLObjectType({
            name: 'Query',
            fields: {
                stats: {
                    type: new GraphQLNonNull(new GraphQLObjectType({
                        name: 'Stats',
                        fields: {
                            homePageMain: statsField('HomePageMainStats', COVID_SITE, homePageMainStats, {
                                interfaces: [dateUpdatedInterface],
                                fields: dateUpdatedFields
                            }),
                            homePageVax: statsField('HomePageVaxStats', COVID_SITE, homePageVaxStats, {
                                interfaces: [dateUpdatedInterface],
                                fields: dateUpdatedFields
                            }),
                            dataPage: statsField('DataPageStats', `${COVID_SITE}/victorian-coronavirus-covid-19-data`, dataPageStats, { fields: makeUpdatedFields(GraphQLDateTime) })
                        }
                    })),
                    resolve: async (_, __, ___, info) => {
                        const fields = graphqlFields(info);
                        const statFields = Object.values(fields).flatMap(Object.keys).filter((field) => field !== 'updated');
                        const [homePageMainUpdated, homePageVaxUpdated, dataPageUpdated, { dose1, dose2, dose3, newCases, newPCRTests, newRATCases, hospitalCases, icuCases, newDeaths, newPCRCases, activeCases, totalPCRTests, totalPCRCases, totalDeaths, totalRecovered }] = await Promise.all([
                            fields.homePageMain?.updated
                                ? fetchParagraph(HOME_PAGE_MAIN_UPDATED_ID, 'home page (main)').then(parseHomePageDate)
                                : undefined,
                            fields.homePageVax?.updated
                                ? fetchParagraph(HOME_PAGE_VAX_UPDATED_ID, 'home page (vaccination)').then(parseHomePageDate)
                                : undefined,
                            fields.dataPage?.updated
                                ? fetchParagraph(DATA_PAGE_UPDATED_ID, 'data page').then(text => {
                                    const [, day, month, year, hour, minute, aOrP] = DATA_PAGE_UPDATED_RE.exec(text);
                                    const hourNum = Number(hour);
                                    return `${year}-${MONTHS[month]}-${day}T${aOrP === 'a'
                                        ? hourNum === 12
                                            ? '00'
                                            : String(hourNum).padStart(2, '0')
                                        : hourNum === 12
                                            ? hour
                                            : hourNum + 12}:${minute}:00+10:00`;
                                })
                                : undefined,
                            statFields.length
                                ? covidAPI('paragraph/statistic_block', 'stats', {
                                    fields: {
                                        'paragraph--statistics_block': 'field_statistic_heading'
                                    },
                                    filter: {
                                        c: {
                                            path: 'id',
                                            operator: 'IN',
                                            value: statFields.map(field => NAME_TO_IDS[field])
                                        }
                                    }
                                }).then(data => Object.fromEntries(data.map(({ id, attributes: { field_statistic_heading: stat } }) => [IDS_TO_NAME[id], stat])))
                                : {}
                        ]);
                        return {
                            homePageMain: {
                                updated: homePageMainUpdated,
                                newCases,
                                newPCRTests,
                                newRATCases,
                                hospitalCases,
                                icuCases,
                                newDeaths
                            },
                            homePageVax: {
                                updated: homePageVaxUpdated,
                                dose1,
                                dose2,
                                dose3
                            },
                            dataPage: {
                                updated: dataPageUpdated,
                                newPCRCases,
                                activeCases,
                                totalPCRTests,
                                totalPCRCases,
                                totalDeaths,
                                totalRecovered
                            }
                        };
                    }
                }
            }
        })
    })
}).createHandler({ cors: { origin: '*' } });
