const React = require('react');
const h = require('react-hyperscript');
const Table = require('react-table').default;

const queryString = require('query-string');
const color = require('color');
const _ = require('lodash');
const classNames = require('classnames');
const matchSorter = require('match-sorter').default;

const make_cytoscape = require('../../common/cy');

const Icon = require('../../common/components').Icon;
const { apiCaller, PathwayCommonsService } = require('../../services');


const analysisFunctions = [
  {
    name: 'mean',
    func: _.mean,
  },
  {
    name: 'count',
    func: _.countBy,
  },
  {
    name: 'min',
    func: _.min
  },
  {
    name: 'max',
    func: _.max
  }
];

class OmniBar extends React.Component {
  render() {
    const props = this.props;
    return h('div.paint-omnibar', [
      h('a', { onClick: e => props.onMenuClick(e) }, [
        h(Icon, { icon: 'menu' }, 'click')
      ]),
      h('h5', `${props.name} | ${props.datasource}`)
    ]);
  }
}

// props
// expression table
// cy
class Network extends React.Component {
  componentWillUnmount() {
    this.state.cy.destroy();
  }

  componentDidMount() {
    const props = this.props;
    const container = document.getElementById('cy-container');
    props.cy.mount(container);
  }

  colourMap(val, min, max) {
    const distToMax = Math.abs(val - max);
    const distToMin = Math.abs(val - min);

    let hVal, lVal;
    if (distToMax > distToMin) {
      hVal = 240;
      lVal = ( val / Math.abs(max) ) * 100 + 20;
    } else {
      hVal = 0;
      lVal = ( val / Math.abs(max) ) * 100 - 20;
    }
    return color.hsl(hVal, 100, lVal).string();
  }

  percentToColour(percent) {
    const hslValue = ( 1 - percent ) * 240;

    return color.hsl(hslValue, 100, 50).string();
  }

  componentWillReceiveProps(nextProps) {
    if (!_.isEmpty(nextProps.expressionTable)) {
      this.applyExpressionData(nextProps);
    }
  }

  applyExpressionData(props) {
    const expressionTable = props.expressionTable;
    const networkNodes = _.uniq(props.cy.nodes('[class="macromolecule"]').map(node => node.data('label'))).sort();

    const expressionsInNetwork = expressionTable.rows.filter(row => networkNodes.includes(row.geneName));
    const maxVal = _.max(expressionsInNetwork.map(row => _.max(row.classValues)).map((k, v) => parseFloat(k)));
    const minVal = _.min(expressionsInNetwork.map(row => _.min(row.classValues)).map((k, v) => parseFloat(k)));

    expressionsInNetwork.forEach(expression => {
      // probably more efficient to add the expression data to the node field instead of interating twice
      props.cy.nodes().filter(node => node.data('label') === expression.geneName).forEach(node => {

        const numSlices = expression.classValues.length > 16 ? 16 : expression.classValues.length;

        const pieStyle = {
          'pie-size': '100%'
        };
        for (let i = 1; i <= numSlices; i++) {

          pieStyle['pie-' + i + '-background-size'] = 100 / numSlices;
          pieStyle['pie-' + i + '-background-opacity'] = 1;
          pieStyle['pie-' + i + '-background-color'] = this.percentToColour(expression.classValues[i-1] / maxVal);
        }

        node.style(pieStyle);
      });
    });
  }

  render() {
    return h('div.paint-graph', [ h(`div.#cy-container`, {style: {width: '100vw', height: '100vh'}}) ]);
  }

}

class Paint extends React.Component {
  constructor(props) {
    super(props);

    const cy = make_cytoscape({headless: true});

    this.state = {
      rawEnrichmentData: {},
      expressionTable: {},
      cy: cy,
      name: '',
      datasource: '',
      drawerOpen: false
    };

    const query = queryString.parse(props.location.search);
    const enrichmentsURI = query.uri ? query.uri : null;

    if (enrichmentsURI != null) {
      fetch(enrichmentsURI)
        .then(response => response.json())
        .then(json => {
          this.setState({rawEnrichmentData: json});

          const expressionClasses = _.get(json.dataSetClassList, '0.classes', []);
          const expressions = _.get(json.dataSetExpressionList, '0.expressions', []);
          const searchParam = query.q;
          this.initPainter(expressions, expressionClasses, searchParam);

        });
    }
  }

  componentWillUnmount() {
    this.state.cy.destroy();
  }

  // only call this after you know component is mounted
  initPainter(expressions, expressionClasses, queryParam) {
    const state = this.state;
    const query = {
      q: queryParam,
      type: 'Pathway'
    };

    apiCaller.querySearch(query)
      .then(searchResults => {
        const uri = _.get(searchResults, '0.uri', null);

        if (uri != null) {
          apiCaller.getGraphAndLayout(uri, 'latest').then(response => {
            this.setState({
              name: _.get(response, 'graph.pathwayMetadata.title', 'N/A'),
              datasource: _.get(response, 'graph.pathwayMetadata.dataSource.0', 'N/A'),
            });

            state.cy.remove('*');
            state.cy.add({
              nodes: _.get(response, 'graph.nodes', []),
              edges: _.get(response, 'graph.edges', [])
            });

            state.cy.layout({
              name: 'cose-bilkent',
              randomize: false,
              nodeDimensionsIncludeLabels: true
            }).run();


            const expressionTable = {};

            const header = _.uniq(expressionClasses);

            expressionTable.header = header;
            expressionTable.rows = expressions.map(expression => {
              const geneName = expression.geneName;
              const values = expression.values;

              const class2ValuesMap = new Map();

              for (let expressionClass of header) {
                class2ValuesMap.set(expressionClass, []);
              }

              for (let i = 0; i < values.length; i++) {
                class2ValuesMap.get(expressionClasses[i]).push(values[i]);
              }

              return { geneName: geneName, classValues: Array.from(class2ValuesMap.entries()).map((entry =>  _.mean(entry[1]).toFixed(2))) };
            });

            this.setState({
              expressionTable: expressionTable
            });
          });
        }
    });
  }

  toggleDrawer() {
    this.setState({drawerOpen: !this.state.drawerOpen});
  }

  render() {
    const state = this.state;

    const expressionTable = state.expressionTable;

    const networkNodes = state.cy.nodes().map(node => node.data('label'));
    const enrichmentsInNetwork = _.get(expressionTable, 'rows', []).filter(row => networkNodes.includes(row.geneName));


    const maxVal = _.max(enrichmentsInNetwork.map(row => _.max(row.classValues)).map((k, v) => parseFloat(k)));
    const minVal = _.min(enrichmentsInNetwork.map(row => _.min(row.classValues)).map((k, v) => parseFloat(k)));

    const expressionHeader = _.get(expressionTable, 'header', []);
    const expressionRows = _.get(expressionTable, 'rows', []);

    const columns = [
      {
        Header: 'Gene Name',
        accessor: 'geneName',
        filterMethod: (filter, rows) => {
          return matchSorter(rows, filter.value, { keys: ["geneName"] });
        },
        filterAll: true
      }
    ].concat(expressionHeader.map((className, index) => {
      return {
        Header: className,
        id: className,
        accessor: row => row.classValues[index]
      };
    }));
    return h('div.paint', [
      h('div.paint-content', [
        h('div', { className: classNames('paint-drawer', { 'closed': !state.drawerOpen }) }, [
          h('a', { onClick: e => this.toggleDrawer()}, [
            h(Icon, { icon: 'close'}),
          ]),
          h('div.paint-legend', [
            h('p', `low ${minVal}`),
            h('p', `high ${maxVal}`)
          ]),
          h('p', `columns correspond to the clockwise direction on the pie (first column starts at 12 O'Clock going clockwise)`),
          h(Table, {data: expressionRows, columns: columns, filterable: true } )
        ]),
        h(OmniBar, { name: state.name, datasource: state.datasource, onMenuClick: (e) => this.toggleDrawer() }),
        h(Network, { cy: state.cy, expressionTable: state.expressionTable })
      ])
    ]);
  }
}

module.exports = Paint;