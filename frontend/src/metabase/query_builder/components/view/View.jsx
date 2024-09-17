/* eslint-disable react/prop-types */
import { match } from "ts-pattern";
import { t } from "ttag";
import _ from "underscore";

import { deletePermanently } from "metabase/archive/actions";
import { ArchivedEntityBanner } from "metabase/archive/components/ArchivedEntityBanner";
import ExplicitSize from "metabase/components/ExplicitSize";
import LoadingAndErrorWrapper from "metabase/components/LoadingAndErrorWrapper";
import Toaster from "metabase/components/Toaster";
import CS from "metabase/css/core/index.css";
import QueryBuilderS from "metabase/css/query_builder.module.css";
import Bookmarks from "metabase/entities/bookmarks";
import Questions from "metabase/entities/questions";
import { useDispatch } from "metabase/lib/redux";
import {
  rememberLastUsedDatabase,
  setArchivedQuestion,
} from "metabase/query_builder/actions";
import { SIDEBAR_SIZES } from "metabase/query_builder/constants";
import { TimeseriesChrome } from "metabase/querying/filters/components/TimeseriesChrome";
import { MetricEditor } from "metabase/querying/metrics/components/MetricEditor";
import { Transition } from "metabase/ui";
import * as Lib from "metabase-lib";

import DatasetEditor from "../DatasetEditor";
import NativeQueryEditor from "../NativeQueryEditor";
import { QueryModals } from "../QueryModals";
import QueryVisualization from "../QueryVisualization";
import { SavedQuestionIntroModal } from "../SavedQuestionIntroModal";
import DataReference from "../dataref/DataReference";
import { SnippetSidebar } from "../template_tags/SnippetSidebar";
import { TagEditorSidebar } from "../template_tags/TagEditorSidebar";

import NewQuestionHeader from "./NewQuestionHeader";
import { NotebookContainer } from "./View/NotebookContainer";
import {
  BorderedViewTitleHeader,
  NativeQueryEditorContainer,
  QueryBuilderContentContainer,
  QueryBuilderMain,
  QueryBuilderViewHeaderContainer,
  QueryBuilderViewRoot,
  StyledDebouncedFrame,
  StyledSyncedParametersList,
} from "./View.styled";
import { ViewFooter } from "./ViewFooter";
import ViewSidebar from "./ViewSidebar";
import ChartSettingsSidebar from "./sidebars/ChartSettingsSidebar";
import { ChartTypeSidebar } from "./sidebars/ChartTypeSidebar";
import { QuestionInfoSidebar } from "./sidebars/QuestionInfoSidebar";
import { QuestionSettingsSidebar } from "./sidebars/QuestionSettingsSidebar";
import { SummarizeSidebar } from "./sidebars/SummarizeSidebar";
import TimelineSidebar from "./sidebars/TimelineSidebar";

const fadeIn = {
  in: { opacity: 1 },
  out: { opacity: 0 },
  transitionProperty: "opacity",
};

const View = ({
  question,
  result,
  isShowingChartSettingsSidebar,
  isShowingChartTypeSidebar,
  onCloseChartSettings,
  addField,
  initialChartSetting,
  onReplaceAllVisualizationSettings,
  onOpenChartType,
  visualizationSettings,
  showSidebarTitle,
  rawSeries,
  databases,
  isShowingNewbModal,
  isShowingTimelineSidebar,
  queryBuilderMode,
  closeQbNewbModal,
  onDismissToast,
  onConfirmToast,
  isShowingToaster,
  isHeaderVisible,
  updateQuestion,
  reportTimezone,
  readOnly,
  isDirty,
  isRunning,
  isRunnable,
  isResultDirty,
  hasVisualizeButton,
  runQuestionQuery,
  cancelQuery,
  setQueryBuilderMode,
  isShowingQuestionInfoSidebar,
  isShowingQuestionSettingsSidebar,
  cancelQuestionChanges,
  onCreate,
  onSave,
  onChangeLocation,
  card,
  height,
  isNativeEditorOpen,
  setParameterValueToDefault,
  mode,
  parameters,
  isLiveResizable,
  setParameterValue,
  questionAlerts,
  isShowingTemplateTagsEditor,
  isShowingDataReference,
  isShowingSnippetSidebar,
  toggleTemplateTagsEditor,
  toggleDataReference,
  toggleSnippetSidebar,
  showTimelineEvent,
  showTimelineEvents,
  hideTimelineEvents,
  selectTimelineEvents,
  deselectTimelineEvents,
  onCloseTimelines,
  onCloseQuestionInfo,
  user,
  modal,
  modalContext,
  onCloseModal,
  onOpenModal,
  originalQuestion,
  timelines,
  isShowingSummarySidebar,
  visibleTimelineEventIds,
  selectedTimelineEventIds,
  xDomain,
  databaseFields,
  sampleDatabaseId,
  setDatasetQuery,
  setTemplateTag,
  setTemplateTagConfig,
  getEmbeddedParameterVisibility,
  dataReferenceStack,
  popDataReferenceStack,
  pushDataReferenceStack,
  setModalSnippet,
  openSnippetModalWithSelectedText,
  insertSnippet,
  isObjectDetail,
  isAdditionalInfoVisible,
  onOpenQuestionInfo,
  isNavBarOpen,
  isBookmarked,
  toggleBookmark,
  isActionListVisible,
  onEditSummary,
  onCloseSummary,
  turnModelIntoQuestion,
  onModelPersistenceChange,
  className,
  nativeEditorSelectedText,
  modalSnippet,
  enableRun,
  canChangeDatabase,
  cancelQueryOnLeave,
  hasTopBar,
  hasParametersList,
  hasEditingSidebar,
  sidebarFeatures,
  resizable,
  resizableBoxProps,
  editorContext,
  handleResize,
  autocompleteResultsFn,
  cardAutocompleteResultsFn,
  setNativeEditorSelectedRange,
  openDataReferenceAtQuestion,
  setIsNativeEditorOpen,
  closeSnippetModal,
  maxTableRows,
  navigateToNewCardInsideQB,
  timelineEvents,
  onNavigateBack,
  onShowTimelineEvents,
  onHideTimelineEvents,
  onSelectTimelineEvents,
  onDeselectTimelineEvents,
  onCancelCreateNewModel,
  setMetadataDiff,
}) => {
  const dispatch = useDispatch();
  const onSetDatabaseId = id => dispatch(rememberLastUsedDatabase(id));
  const onUnarchive = async question => {
    await dispatch(setArchivedQuestion(question, false));
    await dispatch(Bookmarks.actions.invalidateLists());
  };
  const onMove = (question, newCollection) =>
    dispatch(
      Questions.actions.setCollection({ id: question.id() }, newCollection, {
        notify: { undo: false },
      }),
    );
  const onDeletePermanently = id => {
    const deleteAction = Questions.actions.delete({ id });
    dispatch(deletePermanently(deleteAction));
  };

  const getLeftSidebar = () => {
    if (isShowingChartSettingsSidebar) {
      return (
        <ChartSettingsSidebar
          question={question}
          result={result}
          addField={addField}
          initialChartSetting={initialChartSetting}
          onReplaceAllVisualizationSettings={onReplaceAllVisualizationSettings}
          onOpenChartType={onOpenChartType}
          visualizationSettings={visualizationSettings}
          showSidebarTitle={showSidebarTitle}
          onClose={onCloseChartSettings}
        />
      );
    }

    if (isShowingChartTypeSidebar) {
      return <ChartTypeSidebar question={question} result={result} />;
    }

    return null;
  };

  const getRightSidebarForStructuredQuery = () => {
    const isSaved = question.isSaved();

    if (isShowingSummarySidebar) {
      const query = question.query();
      return (
        <SummarizeSidebar
          query={query}
          onQueryChange={nextQuery => {
            const datesetQuery = Lib.toLegacyQuery(nextQuery);
            const nextQuestion = question.setDatasetQuery(datesetQuery);
            updateQuestion(nextQuestion.setDefaultDisplay(), { run: true });
          }}
          onClose={onCloseSummary}
        />
      );
    }

    if (isShowingTimelineSidebar) {
      return (
        <TimelineSidebar
          question={question}
          timelines={timelines}
          visibleTimelineEventIds={visibleTimelineEventIds}
          selectedTimelineEventIds={selectedTimelineEventIds}
          xDomain={xDomain}
          onShowTimelineEvents={showTimelineEvents}
          onHideTimelineEvents={hideTimelineEvents}
          onSelectTimelineEvents={selectTimelineEvents}
          onDeselectTimelineEvents={deselectTimelineEvents}
          onOpenModal={onOpenModal}
          onClose={onCloseTimelines}
        />
      );
    }

    if (isSaved && isShowingQuestionInfoSidebar) {
      return (
        <QuestionInfoSidebar
          question={question}
          onSave={onSave}
          onClose={onCloseQuestionInfo}
        />
      );
    }

    if (isSaved && isShowingQuestionSettingsSidebar) {
      return <QuestionSettingsSidebar question={question} />;
    }

    return null;
  };

  const getRightSidebarForNativeQuery = () => {
    if (isShowingTemplateTagsEditor) {
      return (
        <TagEditorSidebar
          query={question.legacyQuery()}
          onClose={toggleTemplateTagsEditor}
          card={card}
          databases={databases}
          databaseFields={databaseFields}
          question={question}
          sampleDatabaseId={sampleDatabaseId}
          setDatasetQuery={setDatasetQuery}
          setTemplateTag={setTemplateTag}
          setTemplateTagConfig={setTemplateTagConfig}
          setParameterValue={setParameterValue}
          getEmbeddedParameterVisibility={getEmbeddedParameterVisibility}
        />
      );
    }

    if (isShowingDataReference) {
      return (
        <DataReference
          dataReferenceStack={dataReferenceStack}
          popDataReferenceStack={popDataReferenceStack}
          pushDataReferenceStack={pushDataReferenceStack}
          onClose={toggleDataReference}
        />
      );
    }

    if (isShowingSnippetSidebar) {
      return (
        <SnippetSidebar
          setModalSnippet={setModalSnippet}
          openSnippetModalWithSelectedText={openSnippetModalWithSelectedText}
          insertSnippet={insertSnippet}
          onClose={toggleSnippetSidebar}
        />
      );
    }

    if (isShowingTimelineSidebar) {
      return (
        <TimelineSidebar
          question={question}
          timelines={timelines}
          visibleTimelineEventIds={visibleTimelineEventIds}
          selectedTimelineEventIds={selectedTimelineEventIds}
          xDomain={xDomain}
          onOpenModal={onOpenModal}
          onShowTimelineEvents={onShowTimelineEvents}
          onHideTimelineEvents={onHideTimelineEvents}
          onSelectTimelineEvents={onSelectTimelineEvents}
          onDeselectTimelineEvents={onDeselectTimelineEvents}
          onClose={onCloseTimelines}
        />
      );
    }

    if (isShowingQuestionInfoSidebar) {
      return (
        <QuestionInfoSidebar
          question={question}
          onSave={onSave}
          onClose={onCloseQuestionInfo}
        />
      );
    }

    if (isShowingQuestionSettingsSidebar) {
      return <QuestionSettingsSidebar question={question} />;
    }

    return null;
  };

  const getRightSidebar = () => {
    const { isNative } = Lib.queryDisplayInfo(question.query());

    return !isNative
      ? getRightSidebarForStructuredQuery()
      : getRightSidebarForNativeQuery();
  };

  const renderHeader = () => {
    const query = question.query();
    const card = question.card();
    const { isNative } = Lib.queryDisplayInfo(query);

    const isNewQuestion = !isNative && Lib.sourceTableOrCardId(query) === null;

    return (
      <QueryBuilderViewHeaderContainer>
        {card.archived && (
          <ArchivedEntityBanner
            name={card.name}
            entityType={card.type}
            canWrite={card.can_write}
            canRestore={card.can_restore}
            canDelete={card.can_delete}
            onUnarchive={() => onUnarchive(question)}
            onMove={collection => onMove(question, collection)}
            onDeletePermanently={() => onDeletePermanently(card.id)}
          />
        )}

        <BorderedViewTitleHeader
          question={question}
          isObjectDetail={isObjectDetail}
          isAdditionalInfoVisible={isAdditionalInfoVisible}
          onOpenQuestionInfo={onOpenQuestionInfo}
          onSave={onSave}
          onOpenModal={onOpenModal}
          isNavBarOpen={isNavBarOpen}
          originalQuestion={originalQuestion}
          result={result}
          queryBuilderMode={queryBuilderMode}
          updateQuestion={updateQuestion}
          isBookmarked={isBookmarked}
          toggleBookmark={toggleBookmark}
          isRunnable={isRunnable}
          isRunning={isRunning}
          isNativeEditorOpen={isNativeEditorOpen}
          isShowingSummarySidebar={isShowingSummarySidebar}
          isDirty={isDirty}
          isResultDirty={isResultDirty}
          isActionListVisible={isActionListVisible}
          runQuestionQuery={runQuestionQuery}
          cancelQuery={cancelQuery}
          onEditSummary={onEditSummary}
          onCloseSummary={onCloseSummary}
          setQueryBuilderMode={setQueryBuilderMode}
          turnModelIntoQuestion={turnModelIntoQuestion}
          isShowingQuestionInfoSidebar={isShowingQuestionInfoSidebar}
          onCloseQuestionInfo={onCloseQuestionInfo}
          onModelPersistenceChange={onModelPersistenceChange}
          className={className}
          style={{
            transition: "opacity 300ms linear",
            opacity: isNewQuestion ? 0 : 1,
          }}
        />
        {/*This is used so that the New Question Header is unmounted after the animation*/}
        <Transition mounted={isNewQuestion} transition={fadeIn} duration={300}>
          {style => <NewQuestionHeader className={CS.spread} style={style} />}
        </Transition>
      </QueryBuilderViewHeaderContainer>
    );
  };

  const renderNativeQueryEditor = () => {
    const legacyQuery = question.legacyQuery();

    // Normally, when users open native models,
    // they open an ad-hoc GUI question using the model as a data source
    // (using the `/dataset` endpoint instead of the `/card/:id/query`)
    // However, users without data permission open a real model as they can't use the `/dataset` endpoint
    // So the model is opened as an underlying native question and the query editor becomes visible
    // This check makes it hide the editor in this particular case
    // More details: https://github.com/metabase/metabase/pull/20161
    const { isEditable } = Lib.queryDisplayInfo(question.query());
    if (question.type() === "model" && !isEditable) {
      return null;
    }

    return (
      <NativeQueryEditorContainer>
        <NativeQueryEditor
          query={legacyQuery}
          viewHeight={height}
          isOpen={legacyQuery.isEmpty() || isDirty}
          isInitiallyOpen={isNativeEditorOpen}
          datasetQuery={card && card.dataset_query}
          setParameterValueToDefault={setParameterValueToDefault}
          onSetDatabaseId={onSetDatabaseId}
          question={question}
          nativeEditorSelectedText={nativeEditorSelectedText}
          modalSnippet={modalSnippet}
          isNativeEditorOpen={isNativeEditorOpen}
          isRunnable={isRunnable}
          isRunning={isRunning}
          isResultDirty={isResultDirty}
          isShowingDataReference={isShowingDataReference}
          isShowingTemplateTagsEditor={isShowingTemplateTagsEditor}
          isShowingSnippetSidebar={isShowingSnippetSidebar}
          readOnly={readOnly}
          enableRun={enableRun}
          canChangeDatabase={canChangeDatabase}
          cancelQueryOnLeave={cancelQueryOnLeave}
          hasTopBar={hasTopBar}
          hasParametersList={hasParametersList}
          hasEditingSidebar={hasEditingSidebar}
          sidebarFeatures={sidebarFeatures}
          resizable={resizable}
          resizableBoxProps={resizableBoxProps}
          editorContext={editorContext}
          handleResize={handleResize}
          autocompleteResultsFn={autocompleteResultsFn}
          cardAutocompleteResultsFn={cardAutocompleteResultsFn}
          setDatasetQuery={setDatasetQuery}
          runQuestionQuery={runQuestionQuery}
          setNativeEditorSelectedRange={setNativeEditorSelectedRange}
          openDataReferenceAtQuestion={openDataReferenceAtQuestion}
          openSnippetModalWithSelectedText={openSnippetModalWithSelectedText}
          insertSnippet={insertSnippet}
          setIsNativeEditorOpen={setIsNativeEditorOpen}
          setParameterValue={setParameterValue}
          onOpenModal={onOpenModal}
          toggleDataReference={toggleDataReference}
          toggleTemplateTagsEditor={toggleTemplateTagsEditor}
          toggleSnippetSidebar={toggleSnippetSidebar}
          cancelQuery={cancelQuery}
          closeSnippetModal={closeSnippetModal}
        />
      </NativeQueryEditorContainer>
    );
  };

  const renderMain = ({ leftSidebar, rightSidebar }) => {
    if (queryBuilderMode === "notebook") {
      // we need to render main only in view mode
      return;
    }

    const queryMode = mode && mode.queryMode();
    const { isNative } = Lib.queryDisplayInfo(question.query());
    const isSidebarOpen = leftSidebar || rightSidebar;

    return (
      <QueryBuilderMain
        isSidebarOpen={isSidebarOpen}
        data-testid="query-builder-main"
      >
        {isNative ? (
          renderNativeQueryEditor()
        ) : (
          <StyledSyncedParametersList
            parameters={parameters}
            setParameterValue={setParameterValue}
            commitImmediately
          />
        )}

        <StyledDebouncedFrame enabled={!isLiveResizable}>
          <QueryVisualization
            question={question}
            isRunning={isRunning}
            isObjectDetail={isObjectDetail}
            isResultDirty={isResultDirty}
            isNativeEditorOpen={isNativeEditorOpen}
            result={result}
            maxTableRows={maxTableRows}
            isDirty={isDirty}
            queryBuilderMode={queryBuilderMode}
            navigateToNewCardInsideQB={navigateToNewCardInsideQB}
            rawSeries={rawSeries}
            timelineEvents={timelineEvents}
            selectedTimelineEventIds={selectedTimelineEventIds}
            onNavigateBack={onNavigateBack}
            isRunnable={isRunnable}
            runQuestionQuery={runQuestionQuery}
            cancelQuery={cancelQuery}
            noHeader
            className={CS.spread}
            mode={queryMode}
          />
        </StyledDebouncedFrame>
        <TimeseriesChrome
          question={question}
          updateQuestion={updateQuestion}
          className={CS.flexNoShrink}
        />
        <ViewFooter className={CS.flexNoShrink} />
      </QueryBuilderMain>
    );
  };

  // if we don't have a question at all or no databases then we are initializing, so keep it simple
  if (!question || !databases) {
    return <LoadingAndErrorWrapper className={CS.fullHeight} loading />;
  }

  const query = question.query();
  const { isNative } = Lib.queryDisplayInfo(question.query());

  const isNewQuestion = !isNative && Lib.sourceTableOrCardId(query) === null;
  const isModel = question.type() === "model";
  const isMetric = question.type() === "metric";

  if ((isModel || isMetric) && queryBuilderMode === "dataset") {
    return (
      <>
        {isModel && (
          <DatasetEditor
            question={question}
            isDirty={isDirty}
            isRunning={isRunning}
            setQueryBuilderMode={setQueryBuilderMode}
            setMetadataDiff={setMetadataDiff}
            onSave={onSave}
            onCancelCreateNewModel={onCancelCreateNewModel}
            cancelQuestionChanges={cancelQuestionChanges}
            handleResize={handleResize}
            updateQuestion={updateQuestion}
            runQuestionQuery={runQuestionQuery}
            onOpenModal={onOpenModal}
            isShowingTemplateTagsEditor={isShowingTemplateTagsEditor}
            isShowingDataReference={isShowingDataReference}
            isShowingSnippetSidebar={isShowingSnippetSidebar}
            toggleTemplateTagsEditor={toggleTemplateTagsEditor}
            toggleDataReference={toggleDataReference}
            toggleSnippetSidebar={toggleSnippetSidebar}
          />
        )}
        {isMetric && (
          <MetricEditor
            question={question}
            result={result}
            rawSeries={rawSeries}
            reportTimezone={reportTimezone}
            isDirty={isDirty}
            isResultDirty={isResultDirty}
            isRunning={isRunning}
            onChange={updateQuestion}
            onCreate={async question => {
              await onCreate(question);
              setQueryBuilderMode("view");
            }}
            onSave={async question => {
              await onSave(question);
              setQueryBuilderMode("view");
            }}
            onCancel={question => {
              cancelQuestionChanges();
              if (question.isSaved()) {
                setQueryBuilderMode("view");
              } else {
                onChangeLocation("/");
              }
            }}
            onRunQuery={runQuestionQuery}
            onCancelQuery={cancelQuery}
          />
        )}
        <QueryModals
          questionAlerts={questionAlerts}
          user={user}
          onSave={onSave}
          onCreate={onCreate}
          updateQuestion={updateQuestion}
          modal={modal}
          modalContext={modalContext}
          card={card}
          question={question}
          onCloseModal={onCloseModal}
          onOpenModal={onOpenModal}
          setQueryBuilderMode={setQueryBuilderMode}
          originalQuestion={originalQuestion}
          onChangeLocation={onChangeLocation}
        />
      </>
    );
  }

  const isNotebookContainerOpen =
    isNewQuestion || queryBuilderMode === "notebook";

  const leftSidebar = getLeftSidebar();
  const rightSidebar = getRightSidebar();

  const rightSidebarWidth = match({
    isShowingTimelineSidebar,
    isShowingQuestionInfoSidebar,
    isShowingQuestionSettingsSidebar,
  })
    .with({ isShowingTimelineSidebar: true }, () => SIDEBAR_SIZES.TIMELINE)
    .with({ isShowingQuestionInfoSidebar: true }, () => 0)
    .with({ isShowingQuestionSettingsSidebar: true }, () => 0)
    .otherwise(() => SIDEBAR_SIZES.NORMAL);

  return (
    <div className={CS.fullHeight}>
      <QueryBuilderViewRoot
        className={QueryBuilderS.QueryBuilder}
        data-testid="query-builder-root"
      >
        {isHeaderVisible && renderHeader()}

        <QueryBuilderContentContainer>
          {!isNative && (
            <NotebookContainer
              isOpen={isNotebookContainerOpen}
              updateQuestion={updateQuestion}
              reportTimezone={reportTimezone}
              readOnly={readOnly}
              question={question}
              isDirty={isDirty}
              isRunnable={isRunnable}
              isResultDirty={isResultDirty}
              hasVisualizeButton={hasVisualizeButton}
              runQuestionQuery={runQuestionQuery}
              setQueryBuilderMode={setQueryBuilderMode}
            />
          )}
          <ViewSidebar side="left" isOpen={!!leftSidebar}>
            {leftSidebar}
          </ViewSidebar>
          {renderMain({ leftSidebar, rightSidebar })}
          <ViewSidebar
            side="right"
            isOpen={!!rightSidebar}
            width={rightSidebarWidth}
          >
            {rightSidebar}
          </ViewSidebar>
        </QueryBuilderContentContainer>
      </QueryBuilderViewRoot>

      {isShowingNewbModal && (
        <SavedQuestionIntroModal
          question={question}
          isShowingNewbModal={isShowingNewbModal}
          onClose={() => closeQbNewbModal()}
        />
      )}

      <QueryModals
        questionAlerts={questionAlerts}
        user={user}
        onSave={onSave}
        onCreate={onCreate}
        updateQuestion={updateQuestion}
        modal={modal}
        modalContext={modalContext}
        card={card}
        question={question}
        onCloseModal={onCloseModal}
        onOpenModal={onOpenModal}
        setQueryBuilderMode={setQueryBuilderMode}
        originalQuestion={originalQuestion}
        onChangeLocation={onChangeLocation}
      />

      <Toaster
        message={t`Would you like to be notified when this question is done loading?`}
        isShown={isShowingToaster}
        onDismiss={onDismissToast}
        onConfirm={onConfirmToast}
        fixed
      />
    </div>
  );
};

export default _.compose(ExplicitSize({ refreshMode: "debounceLeading" }))(
  View,
);
