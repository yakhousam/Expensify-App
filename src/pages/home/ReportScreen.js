import React from 'react';
import {withOnyx} from 'react-native-onyx';
import PropTypes from 'prop-types';
import {Platform, View} from 'react-native';
import lodashGet from 'lodash/get';
import _ from 'underscore';
import {Freeze} from 'react-freeze';
import styles from '../../styles/styles';
import ScreenWrapper from '../../components/ScreenWrapper';
import HeaderView from './HeaderView';
import Navigation from '../../libs/Navigation/Navigation';
import ROUTES from '../../ROUTES';
import * as Report from '../../libs/actions/Report';
import ONYXKEYS from '../../ONYXKEYS';
import Permissions from '../../libs/Permissions';
import * as ReportUtils from '../../libs/ReportUtils';
import ReportActionsView from './report/ReportActionsView';
import CONST from '../../CONST';
import ReportActionsSkeletonView from '../../components/ReportActionsSkeletonView';
import reportActionPropTypes from './report/reportActionPropTypes';
import toggleReportActionComposeView from '../../libs/toggleReportActionComposeView';
import addViewportResizeListener from '../../libs/VisualViewport';
import {withNetwork} from '../../components/OnyxProvider';
import compose from '../../libs/compose';
import networkPropTypes from '../../components/networkPropTypes';
import withWindowDimensions, {windowDimensionsPropTypes} from '../../components/withWindowDimensions';
import OfflineWithFeedback from '../../components/OfflineWithFeedback';
import withDrawerState, {withDrawerPropTypes} from '../../components/withDrawerState';
import ReportFooter from './report/ReportFooter';
import Banner from '../../components/Banner';
import withLocalize from '../../components/withLocalize';
import reportPropTypes from '../reportPropTypes';
import FullPageNotFoundView from '../../components/BlockingViews/FullPageNotFoundView';
import ReportHeaderSkeletonView from '../../components/ReportHeaderSkeletonView';

const propTypes = {
    /** Navigation route context info provided by react navigation */
    route: PropTypes.shape({
        /** Route specific parameters used on this screen */
        params: PropTypes.shape({
            /** The ID of the report this screen should display */
            reportID: PropTypes.string,
        }).isRequired,
    }).isRequired,

    /** Tells us if the sidebar has rendered */
    isSidebarLoaded: PropTypes.bool,

    /** The report currently being looked at */
    report: reportPropTypes,

    /** Array of report actions for this report */
    reportActions: PropTypes.objectOf(PropTypes.shape(reportActionPropTypes)),

    /** Whether the composer is full size */
    isComposerFullSize: PropTypes.bool,

    /** Beta features list */
    betas: PropTypes.arrayOf(PropTypes.string),

    /** The policies which the user has access to */
    policies: PropTypes.objectOf(PropTypes.shape({
        /** The policy name */
        name: PropTypes.string,

        /** The type of the policy */
        type: PropTypes.string,
    })),

    /** Information about the network */
    network: networkPropTypes.isRequired,

    ...windowDimensionsPropTypes,
    ...withDrawerPropTypes,
};

const defaultProps = {
    isSidebarLoaded: false,
    reportActions: {},
    report: {
        maxSequenceNumber: 0,
        hasOutstandingIOU: false,
        isLoadingReportActions: false,
    },
    isComposerFullSize: false,
    betas: [],
    policies: {},
};

/**
 * Get the currently viewed report ID as number
 *
 * @param {Object} route
 * @param {Object} route.params
 * @param {String} route.params.reportID
 * @returns {String}
 */
function getReportID(route) {
    return route.params.reportID.toString();
}

// Keep a reference to the list view height so we can use it when a new ReportScreen component mounts
let reportActionsListViewHeight = 0;

class ReportScreen extends React.Component {
    constructor(props) {
        super(props);

        this.onSubmitComment = this.onSubmitComment.bind(this);
        this.updateViewportOffsetTop = this.updateViewportOffsetTop.bind(this);
        this.chatWithAccountManager = this.chatWithAccountManager.bind(this);
        this.dismissBanner = this.dismissBanner.bind(this);
        this.removeViewportResizeListener = () => {};

        this.state = {
            skeletonViewContainerHeight: reportActionsListViewHeight,
            viewportOffsetTop: 0,
            isBannerVisible: true,
        };
    }

    componentDidMount() {
        this.fetchReportIfNeeded();
        toggleReportActionComposeView(true);
        this.removeViewportResizeListener = addViewportResizeListener(this.updateViewportOffsetTop);
    }

    componentDidUpdate(prevProps) {
        if (this.props.route.params.reportID === prevProps.route.params.reportID) {
            return;
        }

        this.fetchReportIfNeeded();
        toggleReportActionComposeView(true);
    }

    componentWillUnmount() {
        this.removeViewportResizeListener();
    }

    /**
     * @param {String} text
     */
    onSubmitComment(text) {
        Report.addComment(getReportID(this.props.route), text);
    }

    /**
     * When reports change there's a brief time content is not ready to be displayed
     * It Should show the loader if it's the first time we are opening the report
     *
     * @returns {Boolean}
     */
    shouldShowLoader() {
        const reportIDFromPath = getReportID(this.props.route);

        // This means there are no reportActions at all to display, but it is still in the process of loading the next set of actions.
        const isLoadingInitialReportActions = _.isEmpty(this.props.reportActions) && this.props.report.isLoadingReportActions;

        // This is necessary so that when we are retrieving the next report data from Onyx the ReportActionsView will remount completely
        const isTransitioning = this.props.report && this.props.report.reportID !== reportIDFromPath;
        return !reportIDFromPath || isLoadingInitialReportActions || !this.props.report.reportID || isTransitioning;
    }

    fetchReportIfNeeded() {
        const reportIDFromPath = getReportID(this.props.route);

        // It possible that we may not have the report object yet in Onyx yet e.g. we navigated to a URL for an accessible report that
        // is not stored locally yet. If props.report.reportID exists, then the report has been stored locally and nothing more needs to be done.
        // If it doesn't exist, then we fetch the report from the API.
        if (this.props.report.reportID) {
            return;
        }

        Report.fetchChatReportsByIDs([reportIDFromPath], true);
    }

    /**
     * @param {SyntheticEvent} e
     */
    updateViewportOffsetTop(e) {
        const viewportOffsetTop = lodashGet(e, 'target.offsetTop', 0);
        this.setState({viewportOffsetTop});
    }

    dismissBanner() {
        this.setState({isBannerVisible: false});
    }

    chatWithAccountManager() {
        Navigation.navigate(ROUTES.getReportRoute(this.props.accountManagerReportID));
    }

    render() {
        if (!this.props.isSidebarLoaded || _.isEmpty(this.props.personalDetails)) {
            return null;
        }

        // We create policy rooms for all policies, however we don't show them unless
        // - It's a free plan workspace
        // - The report includes guides participants (@team.expensify.com) for 1:1 Assigned
        if (!Permissions.canUseDefaultRooms(this.props.betas)
            && ReportUtils.isDefaultRoom(this.props.report)
            && ReportUtils.getPolicyType(this.props.report, this.props.policies) !== CONST.POLICY.TYPE.FREE
            && !ReportUtils.hasExpensifyGuidesEmails(lodashGet(this.props.report, ['participants'], []))
        ) {
            return null;
        }

        if (!Permissions.canUsePolicyRooms(this.props.betas) && ReportUtils.isUserCreatedPolicyRoom(this.props.report)) {
            return null;
        }

        // We are either adding a workspace room, or we're creating a chat, it isn't possible for both of these to be pending, or to have errors for the same report at the same time, so
        // simply looking up the first truthy value for each case will get the relevant property if it's set.
        const reportID = getReportID(this.props.route);
        const addWorkspaceRoomOrChatPendingAction = lodashGet(this.props.report, 'pendingFields.addWorkspaceRoom') || lodashGet(this.props.report, 'pendingFields.createChat');
        const addWorkspaceRoomOrChatErrors = lodashGet(this.props.report, 'errorFields.addWorkspaceRoom') || lodashGet(this.props.report, 'errorFields.createChat');
        const screenWrapperStyle = [styles.appContent, {marginTop: this.state.viewportOffsetTop}];
        return (
            <Freeze
                freeze={this.props.isSmallScreenWidth && this.props.isDrawerOpen}
                placeholder={(
                    <ScreenWrapper
                        style={screenWrapperStyle}
                    >
                        <ReportHeaderSkeletonView />
                        <ReportActionsSkeletonView containerHeight={this.state.skeletonViewContainerHeight} />
                    </ScreenWrapper>
                )}
            >
                <ScreenWrapper
                    style={screenWrapperStyle}
                    keyboardAvoidingViewBehavior={Platform.OS === 'android' ? '' : 'padding'}
                >
                    <FullPageNotFoundView
                        shouldShow={!this.props.report.reportID}
                        subtitleKey="notFound.noAccess"
                        shouldShowCloseButton={false}
                        shouldShowBackButton={this.props.isSmallScreenWidth}
                        onBackButtonPress={() => {
                            Navigation.navigate(ROUTES.HOME);
                        }}
                    >
                        <OfflineWithFeedback
                            pendingAction={addWorkspaceRoomOrChatPendingAction}
                            errors={addWorkspaceRoomOrChatErrors}
                            shouldShowErrorMessages={false}
                        >
                            <HeaderView
                                reportID={reportID}
                                onNavigationMenuButtonClicked={() => Navigation.navigate(ROUTES.HOME)}
                                personalDetails={this.props.personalDetails}
                                report={this.props.report}
                                policies={this.props.policies}
                            />
                        </OfflineWithFeedback>
                        {this.props.accountManagerReportID && ReportUtils.isConciergeChatReport(this.props.report) && this.state.isBannerVisible && (
                            <Banner
                                containerStyles={[styles.mh4, styles.mt4, styles.p4, styles.bgDark]}
                                textStyles={[styles.colorReversed]}
                                text={this.props.translate('reportActionsView.chatWithAccountManager')}
                                onClose={this.dismissBanner}
                                onPress={this.chatWithAccountManager}
                                shouldShowCloseButton
                            />
                        )}
                        <View
                            nativeID={CONST.REPORT.DROP_NATIVE_ID}
                            style={[styles.flex1, styles.justifyContentEnd, styles.overflowHidden]}
                            onLayout={(event) => {
                                const skeletonViewContainerHeight = event.nativeEvent.layout.height;

                                // The height can be 0 if the component unmounts - we are not interested in this value and want to know how much space it
                                // takes up so we can set the skeleton view container height.
                                if (skeletonViewContainerHeight === 0) {
                                    return;
                                }

                                reportActionsListViewHeight = skeletonViewContainerHeight;
                                this.setState({skeletonViewContainerHeight});
                            }}
                        >
                            {this.shouldShowLoader()
                                ? (
                                    <ReportActionsSkeletonView
                                        containerHeight={this.state.skeletonViewContainerHeight}
                                    />
                                )
                                : (
                                    <>
                                        <ReportActionsView
                                            reportActions={this.props.reportActions}
                                            report={this.props.report}
                                            session={this.props.session}
                                            isComposerFullSize={this.props.isComposerFullSize}
                                            isDrawerOpen={this.props.isDrawerOpen}
                                        />
                                        <ReportFooter
                                            errors={addWorkspaceRoomOrChatErrors}
                                            pendingAction={addWorkspaceRoomOrChatPendingAction}
                                            isOffline={this.props.network.isOffline}
                                            reportActions={this.props.reportActions}
                                            report={this.props.report}
                                            isComposerFullSize={this.props.isComposerFullSize}
                                            onSubmitComment={this.onSubmitComment}
                                        />
                                    </>
                                )}
                        </View>
                    </FullPageNotFoundView>
                </ScreenWrapper>
            </Freeze>
        );
    }
}

ReportScreen.propTypes = propTypes;
ReportScreen.defaultProps = defaultProps;

export default compose(
    withLocalize,
    withWindowDimensions,
    withDrawerState,
    withNetwork(),
    withOnyx({
        isSidebarLoaded: {
            key: ONYXKEYS.IS_SIDEBAR_LOADED,
        },
        session: {
            key: ONYXKEYS.SESSION,
        },
        reportActions: {
            key: ({route}) => `${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${getReportID(route)}`,
            canEvict: false,
        },
        report: {
            key: ({route}) => `${ONYXKEYS.COLLECTION.REPORT}${getReportID(route)}`,
        },
        isComposerFullSize: {
            key: ({route}) => `${ONYXKEYS.COLLECTION.REPORT_IS_COMPOSER_FULL_SIZE}${getReportID(route)}`,
        },
        betas: {
            key: ONYXKEYS.BETAS,
        },
        policies: {
            key: ONYXKEYS.COLLECTION.POLICY,
        },
        accountManagerReportID: {
            key: ONYXKEYS.ACCOUNT_MANAGER_REPORT_ID,
        },
        personalDetails: {
            key: ONYXKEYS.PERSONAL_DETAILS,
        },
    }),
)(ReportScreen);
