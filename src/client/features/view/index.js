const React = require('react');
const h = require('react-hyperscript');
const _ = require('lodash');
const queryString = require('query-string');
const Loader = require('react-loader');

const make_cytoscape = require('../../common/cy/');

const { ServerAPI } = require('../../services/');

const { BaseNetworkView } = require('../../common/components');
const { getLayoutConfig } = require('../../common/cy/layout');


class View extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      cy: make_cytoscape({ headless: true }),
      componentConfig: {},
      layoutConfig: {},
      networkJSON: {},
      networkMetadata: {
        name: '',
        datasource: '',
        comments: []
      },
      loading: true
    };

    const query = queryString.parse(props.location.search);

    ServerAPI.getGraphAndLayout(query.uri, 'latest').then(networkJSON => {
      const layoutConfig = getLayoutConfig(networkJSON.layout);
      const componentConfig = _.merge({}, BaseNetworkView.config, { useSearchBar: true});

      this.setState({
        componentConfig: componentConfig,
        layoutConfig: layoutConfig,
        networkJSON: networkJSON.graph,
        networkMetadata: {
          uri: query.uri,
          name: _.get(networkJSON, 'graph.pathwayMetadata.title.0', 'Unknown Network'),
          datasource: _.get(networkJSON, 'graph.pathwayMetadata.dataSource.0', 'Unknown Data Source'),
          comments: networkJSON.graph.pathwayMetadata.comments,
          organism: networkJSON.graph.pathwayMetadata.organism
        },
        loading: false
      });
    });
  }

  render() {
    const state = this.state;

    const baseView = h(BaseNetworkView.component, {
      layoutConfig: state.layoutConfig,
      componentConfig: state.componentConfig,
      cy: state.cy,
      networkJSON: state.networkJSON,
      networkMetadata: state.networkMetadata
    });

    const loadingView = h(Loader, { loaded: !state.loading, options: { left: '50%', color: '#16A085' }});

    // create a view shell loading view e.g looks like the view but its not
    const content = state.loading ? loadingView : baseView;

    return h('div', [content]);
  }

}


module.exports = View;